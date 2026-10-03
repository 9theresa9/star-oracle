import { useEffect,useRef,type ReactNode } from 'react';
import { X } from 'lucide-react';
export function OracleModal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;if(element&&!element.open)element.showModal();return()=>{if(element?.open)element.close();};},[]);
 return <dialog ref={dialog} className="oracle-dialog" aria-label={title} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="oracle-dialog-inner"><div className="oracle-dialog-heading"><span className="eyebrow">A FIELD GUIDE / 学习图鉴</span><button type="button" className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={18}/></button></div>{children}</div></dialog>;
}
