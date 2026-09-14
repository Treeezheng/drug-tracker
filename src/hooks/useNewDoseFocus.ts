import { useEffect, useState } from 'react';
import { focusDoseRow } from '../lib/dose-row-focus';

/** One requested focus after a newly created row and any closing picker have committed. */
export function useNewDoseFocus(ready:boolean){
  const [pendingId,setPendingId]=useState<string|null>(null);
  useEffect(()=>{
    if(!ready||!pendingId)return;
    const frame=requestAnimationFrame(()=>{
      if(focusDoseRow(document,pendingId))setPendingId(current=>current===pendingId?null:current);
    });
    return()=>cancelAnimationFrame(frame);
  },[pendingId,ready]);
  return setPendingId;
}
