import { useState } from 'react';

export default function RecoveryKeyPanel({recoveryKey,onDone,rotated=false}:{recoveryKey:string;onDone:()=>void;rotated?:boolean}) {
  const [saved,setSaved]=useState(false),[message,setMessage]=useState('');
  async function copy(){try{await navigator.clipboard.writeText(recoveryKey);setMessage('Copied. Store it somewhere private.');}catch{setMessage('Copy was unavailable. Select the key or download it instead.');}}
  function download(){
    const file=new Blob([`Drug Tracker recovery key\n\n${recoveryKey}\n\nKeep this file private. We cannot recover this key or your password. If you lose both, your records cannot be recovered.\n`],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download='drug-tracker-recovery-key.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setMessage('Download requested. Check that the file was saved, then keep it private.');
  }
  return <div className="recovery-key-panel">
    <p>Keep this recovery key somewhere private, such as your password manager or a safe offline location.</p>
    <p><strong>Keeping this key safe is your responsibility. We cannot recover your password or recovery key. If you lose both, your records cannot be recovered.</strong></p>
    <label className="field"><span>{rotated?'New recovery key':'Recovery key'}</span><textarea className="cloud-recovery-key" readOnly value={recoveryKey} autoComplete="off" spellCheck={false} autoCapitalize="none"/></label>
    <div className="security-actions"><button type="button" className="button secondary small" onClick={()=>void copy()}>Copy key</button><button type="button" className="button secondary small" onClick={download}>Download key</button></div>
    <p className="field-hint">Anyone with this key may access your records. Downloaded copies are not encrypted.</p>
    {rotated&&<p className="muted">Old keys cannot unlock new versions, but may still unlock earlier saved copies. Those copies cannot be revoked.</p>}
    {message&&<p role="status" className="field-hint">{message}</p>}
    <label className="check-line"><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>I have saved my recovery key and understand this responsibility.</label>
    <div className="modal-footer"><button type="button" className="button primary" disabled={!saved} onClick={onDone}>Continue</button></div>
  </div>;
}
