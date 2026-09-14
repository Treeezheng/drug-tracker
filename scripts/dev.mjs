import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['server/index.mjs'], {stdio:'inherit'}),spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {stdio:'inherit'})];
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {for (const child of children) child.kill(signal);process.exit();});
for (const child of children) child.on('exit', (code) => {if(code){for(const other of children)other.kill();process.exit(code);}});
