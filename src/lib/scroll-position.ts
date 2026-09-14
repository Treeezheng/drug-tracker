/** Keep an interacted control in place after a synchronous layout change above it. */
export function captureScrollPosition(element:HTMLElement):()=>void {
  const document=element.ownerDocument,view=document.defaultView;
  let scroller=document.scrollingElement as HTMLElement|null;
  for(let parent=element.parentElement;parent&&parent!==document.scrollingElement;parent=parent.parentElement){
    // A dialog is its own scroll surface, even when its content currently fits.
    // Never compensate a modal resize by scrolling the page behind the dialog.
    if(parent.tagName==='DIALOG'||/^(auto|scroll|overlay)$/.test(view?.getComputedStyle(parent).overflowY??'')){
      scroller=parent;break;
    }
  }
  const top=element.getBoundingClientRect().top;
  let restored=false;
  return ()=>{
    if(restored)return;
    restored=true;
    if(!scroller||!element.isConnected||element.ownerDocument!==document||!Number.isFinite(top))return;
    // Reading final geometry includes any anchoring the browser already applied.
    const delta=element.getBoundingClientRect().top-top;
    if(!Number.isFinite(delta)||Math.abs(delta)<0.5)return;
    const next=Math.max(0,Math.min(scroller.scrollHeight-scroller.clientHeight,scroller.scrollTop+delta));
    if(Math.abs(next-scroller.scrollTop)>=0.5)scroller.scrollTo({top:next,behavior:'instant'});
  };
}
