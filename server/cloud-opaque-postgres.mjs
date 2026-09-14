import { CloudError } from './cloud-errors.mjs';
import { validateVaultWrite, VaultStoreError } from './vault-store.mjs';

const denied=()=>{throw new CloudError(401,'Authentication changed. Start again.');};
const invalid=()=>{throw new CloudError(400,'Invalid authentication state.');};
const modes=['register','login','reauth','reauth-grant','recover','recover-commit','change','migrate'];
const same=(a,b)=>{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
};
const binary=(value,length)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length!==Math.ceil(length*4/3))invalid();const bytes=Buffer.from(value,'base64url');if(bytes.length!==length||bytes.toString('base64url')!==value)invalid();return value;};
const digest=value=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))invalid();return value;};
const version=value=>{if(!Number.isSafeInteger(value)||value<1||value>=Number.MAX_SAFE_INTEGER)invalid();return value;};
const challengeRow=row=>row?{idHash:row.id_hash,kind:row.kind,ownerId:row.owner_id,username:row.username,sourceHash:row.source_hash,authVersion:row.auth_version===null?null:Number(row.auth_version),sessionHash:row.session_hash,expiresAt:Number(row.expires_at),payload:row.payload}:null;

/** Called only inside the existing schema migration transaction/advisory lock. */
export async function initializeOpaquePostgres(client) {
  await client.query(`ALTER TABLE drug_tracker.accounts
    ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'legacy-scrypt' CHECK(auth_mode IN ('legacy-scrypt','opaque-v1')),
    ADD COLUMN auth_version BIGINT NOT NULL DEFAULT 1 CHECK(auth_version>0 AND auth_version<=9007199254740991),
    ADD COLUMN opaque_record TEXT,
    ADD COLUMN recovery_auth_hash TEXT;
    CREATE TABLE drug_tracker.auth_secrets (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), opaque_setup TEXT NOT NULL CHECK(length(opaque_setup)=171)
    );
    CREATE TABLE drug_tracker.auth_challenges (
      id_hash TEXT PRIMARY KEY CHECK(id_hash ~ '^[a-f0-9]{64}$'),
      kind TEXT NOT NULL CHECK(kind IN ('register','login','reauth','reauth-grant','recover','recover-commit','change','migrate')),
      owner_id TEXT, username TEXT NOT NULL, source_hash TEXT NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
      auth_version BIGINT, session_hash TEXT, expires_at BIGINT NOT NULL, payload JSONB NOT NULL
    );
    CREATE INDEX auth_challenges_expiry ON drug_tracker.auth_challenges(expires_at);
    CREATE INDEX auth_challenges_subject ON drug_tracker.auth_challenges(username);
    CREATE INDEX auth_challenges_source ON drug_tracker.auth_challenges(source_hash);
    UPDATE drug_tracker.meta SET version=3 WHERE singleton=1;`);
}

/** Existing repository supplies account→session transaction locking and row readers. */
export function opaquePostgresMethods({pool,transaction,lockOwner,requireSession,addSession,read,cleanupExpiredSessions}) {
  const opaqueOwner=async(client,owner,authVersion,sessionHash,mode='SHARE')=>{
    version(authVersion);const fresh=await lockOwner(client,owner,mode);
    if(fresh.auth_mode!=='opaque-v1'||Number(fresh.auth_version)!==authVersion)denied();
    if(sessionHash!==undefined)await requireSession(client,owner,sessionHash);
    return fresh;
  };
  const writePair=async(client,owner,accepted,current)=>{
    const currentRevision=Number(current?.revision??0);
    if(currentRevision!==accepted.expectedRevision)throw new VaultStoreError(409,'This encrypted vault changed. Reload before saving.',{currentRevision});
    if(currentRevision>=Number.MAX_SAFE_INTEGER)throw new VaultStoreError(409,'The encrypted vault revision limit was reached.');
    const now=new Date().toISOString();
    await client.query(`INSERT INTO drug_tracker.vaults VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6) ON CONFLICT(owner_id) DO UPDATE SET
      revision=EXCLUDED.revision,data_envelope=EXCLUDED.data_envelope,key_envelope=EXCLUDED.key_envelope,updated_at=EXCLUDED.updated_at`,[owner,currentRevision+1,accepted.data,accepted.key,current?.created_at??now,now]);
    return read(client,owner);
  };
  return {
    getOrCreateOpaqueSetup(candidate,expectedOverride){
      if(expectedOverride!==undefined)binary(expectedOverride,128);
      return transaction(async client=>{
        await client.query('SELECT pg_advisory_xact_lock(742091, 2)');
        let row=(await client.query('SELECT opaque_setup FROM drug_tracker.auth_secrets WHERE singleton=1')).rows[0];
        if(!row){
          if((await client.query("SELECT 1 FROM drug_tracker.accounts WHERE auth_mode='opaque-v1' LIMIT 1")).rowCount)throw new CloudError(503,'OPAQUE server setup is unavailable. Restore the existing authentication setup.');
          binary(candidate,128);await client.query('INSERT INTO drug_tracker.auth_secrets VALUES(1,$1)',[candidate]);row={opaque_setup:candidate};
        }
        binary(row.opaque_setup,128);
        if(expectedOverride!==undefined&&expectedOverride!==row.opaque_setup)throw new CloudError(400,'OPAQUE setup override does not match the stored setup.');
        return row.opaque_setup;
      });
    },
    opaqueAccountById:async owner=>(await pool.query('SELECT * FROM drug_tracker.accounts WHERE id=$1',[owner])).rows[0]??null,
    createOpaqueChallenge(row){
      digest(row.idHash);digest(row.sourceHash);if(!modes.includes(row.kind)||typeof row.username!=='string'||!row.username||row.username.length>192
        ||!Number.isSafeInteger(row.expiresAt)||row.expiresAt<=Date.now()||row.expiresAt>Date.now()+120_000||!row.payload||typeof row.payload!=='object'||Array.isArray(row.payload))invalid();
      if(row.authVersion!==null)version(row.authVersion);if(row.sessionHash!==null)digest(row.sessionHash);
      const payload=JSON.stringify(row.payload);if(Buffer.byteLength(payload)>16384)invalid();
      return transaction(async client=>{
        // Bounded admission is shared across dynos and serialized independently of account locks.
        await client.query('SELECT pg_advisory_xact_lock(742091, 3)');
        await client.query('DELETE FROM drug_tracker.auth_challenges WHERE expires_at<=$1',[Date.now()]);
        const counts=(await client.query(`SELECT count(*)::int AS total,
          count(*) FILTER(WHERE source_hash=$1)::int AS source,
          count(*) FILTER(WHERE username=$2)::int AS subject FROM drug_tracker.auth_challenges`,[row.sourceHash,row.username])).rows[0];
        if(counts.total>=1000||counts.source>=40||counts.subject>=12)throw new CloudError(429,'Too many pending authentication attempts. Wait briefly and restart.',{retryAfter:2});
        await client.query('INSERT INTO drug_tracker.auth_challenges VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[row.idHash,row.kind,row.ownerId,row.username,row.sourceHash,row.authVersion,row.sessionHash,row.expiresAt,payload]);
      });
    },
    async takeOpaqueChallenge(idHash,kind,sourceHash){
      digest(idHash);digest(sourceHash);if(!modes.includes(kind))invalid();
      // Consumption commits even when an otherwise matching challenge has expired.
      const row=await transaction(async client=>(await client.query('DELETE FROM drug_tracker.auth_challenges WHERE id_hash=$1 AND kind=$2 AND source_hash=$3 RETURNING *',[idHash,kind,sourceHash])).rows[0]);
      if(!row||Number(row.expires_at)<=Date.now())denied();return challengeRow(row);
    },
    checkOpaqueOwner(owner,authVersion,sessionHash){return transaction(client=>opaqueOwner(client,owner,authVersion,sessionHash));},
    async loginOpaque({ownerId,authVersion},value){await cleanupExpiredSessions();return transaction(async client=>{const fresh=await opaqueOwner(client,ownerId,authVersion);await addSession(client,ownerId,value);return fresh;});},
    recoveryVault(owner,authVersion,expectedRecoveryHash){
      digest(expectedRecoveryHash);return transaction(async client=>{const fresh=await opaqueOwner(client,owner,authVersion);if(fresh.recovery_auth_hash!==expectedRecoveryHash)denied();return read(client,owner);});
    },
    async registerOpaque({challenge,registrationRecord,vaultInput,recoveryAuthHash},value){
      binary(registrationRecord,192);digest(recoveryAuthHash);
      if(challenge.kind!=='register'||!challenge.ownerId||typeof challenge.username!=='string'||!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(challenge.username))invalid();
      const name=challenge.payload?.name??challenge.username;if(typeof name!=='string'||!name.trim()||name.length>100)invalid();
      const accepted=validateVaultWrite(challenge.ownerId,vaultInput);if(accepted.expectedRevision!==0||vaultInput.keyEnvelope.version!==3)invalid();
      await cleanupExpiredSessions();
      return transaction(async client=>{
        const now=new Date().toISOString();let fresh;
        try{fresh=(await client.query(`INSERT INTO drug_tracker.accounts(id,username,password_hash,name,created_at,auth_mode,auth_version,opaque_record,recovery_auth_hash)
          VALUES($1,$2,'!opaque-v1',$3,$4,'opaque-v1',1,$5,$6) RETURNING *`,[challenge.ownerId,challenge.username,name,now,registrationRecord,recoveryAuthHash])).rows[0];}
        catch(error){if(error.code==='23505')throw new CloudError(409,'Username is unavailable.');throw error;}
        const vault=await writePair(client,challenge.ownerId,accepted,null);await addSession(client,challenge.ownerId,value);return{user:fresh,vault};
      });
    },
    commitOpaque(input,replacement){
      const {kind,ownerId,authVersion,sessionHash,expectedLegacyHash,expectedRecoveryHash,registrationRecord,vaultInput,recoveryAuthHash}=input;
      if(!['migrate','recover','change','rotate-recovery'].includes(kind))invalid();version(authVersion);
      if(kind!=='rotate-recovery')binary(registrationRecord,192);
      if(kind!=='change')digest(recoveryAuthHash);
      if(kind==='recover')digest(expectedRecoveryHash);
      const accepted=validateVaultWrite(ownerId,vaultInput);if(vaultInput.keyEnvelope.version!==3)invalid();
      return transaction(async client=>{
        const fresh=await lockOwner(client,ownerId,'UPDATE');if(Number(fresh.auth_version)!==authVersion)denied();
        if(kind!=='recover'){if(typeof sessionHash!=='string')denied();await requireSession(client,ownerId,sessionHash);}
        if(kind==='migrate'){if(fresh.auth_mode!=='legacy-scrypt'||typeof expectedLegacyHash!=='string'||fresh.password_hash!==expectedLegacyHash)denied();}
        else{if(fresh.auth_mode!=='opaque-v1')denied();if(kind==='recover'&&fresh.recovery_auth_hash!==expectedRecoveryHash)denied();}
        const current=(await client.query('SELECT * FROM drug_tracker.vaults WHERE owner_id=$1',[ownerId])).rows[0];
        if(kind!=='migrate'&&!current)denied();
        if(kind==='change'&&!same(current.data_envelope,vaultInput.dataEnvelope))throw new CloudError(400,'Changing the password must retain the current data ciphertext.');
        const vault=await writePair(client,ownerId,accepted,current);
        const updated=(await client.query(`UPDATE drug_tracker.accounts SET password_hash='!opaque-v1',auth_mode='opaque-v1',auth_version=auth_version+1,
          opaque_record=$1,recovery_auth_hash=$2 WHERE id=$3 RETURNING *`,[kind==='rotate-recovery'?fresh.opaque_record:registrationRecord,kind==='change'?fresh.recovery_auth_hash:recoveryAuthHash,ownerId])).rows[0];
        await client.query('DELETE FROM drug_tracker.sessions WHERE owner_id=$1',[ownerId]);
        await client.query('DELETE FROM drug_tracker.auth_challenges WHERE owner_id=$1',[ownerId]);
        await addSession(client,ownerId,replacement);return{user:updated,vault};
      });
    },
    sensitiveOpaque({kind,ownerId,authVersion,sessionHash}){
      if(!['delete-account','logout-all'].includes(kind)||typeof sessionHash!=='string')invalid();
      return transaction(async client=>{
        await opaqueOwner(client,ownerId,authVersion,sessionHash,'UPDATE');
        await client.query('DELETE FROM drug_tracker.sessions WHERE owner_id=$1',[ownerId]);
        await client.query('DELETE FROM drug_tracker.auth_challenges WHERE owner_id=$1',[ownerId]);
        if(kind==='delete-account'){await client.query('DELETE FROM drug_tracker.vaults WHERE owner_id=$1',[ownerId]);await client.query('DELETE FROM drug_tracker.accounts WHERE id=$1',[ownerId]);}
        else await client.query('UPDATE drug_tracker.accounts SET auth_version=auth_version+1 WHERE id=$1',[ownerId]);
      });
    },
  };
}

export function validateOrdinaryVaultKey(account,current,keyEnvelope){
  if(account.auth_mode==='opaque-v1'){
    if(!current||keyEnvelope.version!==3||!same(current.key_envelope,keyEnvelope))throw new CloudError(400,'Use the authenticated security flow to change encryption settings.');
  }else if(keyEnvelope.version===3)throw new CloudError(400,'Migrate this account before using OPAQUE encryption.');
}
