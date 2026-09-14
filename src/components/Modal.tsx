import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
export default function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
  return <dialog aria-label={title} className={`modal ${wide?'wide':''}`} ref={dialog} onCancel={onClose}><div className="modal-heading"><h2>{title}</h2><button aria-label="Close dialog" className="icon-button" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
