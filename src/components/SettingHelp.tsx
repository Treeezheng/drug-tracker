import { useId, useState } from 'react';
import { Info } from 'lucide-react';

export default function SettingHelp({label,children}:{label:string;children:string}){
  const [open,setOpen]=useState(false),id=useId();
  return <span className="setting-help"><button type="button" className="icon-button" aria-label={`About ${label}`} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}><Info size={15}/></button><span className="setting-help-text" id={id} hidden={!open}>{children}</span></span>;
}
