import assert from 'node:assert/strict';
import {fixture as installedFixture} from './installed-client-fixture.mjs';
export const TASK_COUNT=400;
export function populateButtonWorkload(board,{role='active'}={}){
 assert.ok(['active','sole','exhausted'].includes(role),'Reviewed400-task fixture role');
 assert.ok(Array.isArray(board.tasks)&&board.tasks.length>0&&board.tasks.length<=TASK_COUNT,'Supported task source for400-task fixture');
 const template=board.tasks.at(-1);
 while(board.tasks.length<TASK_COUNT){
  const index=board.tasks.length;
  board.tasks.push({...structuredClone(template),id:'gate-load-'+index,title:'Gate400 workload task '+index,createdAt:10000+index,done:role!=='active',completedAt:role==='active'?null:10000,lastDoneAt:role==='active'?null:10000,ctx:[],due:null,startsAt:null,prerequisites:[],woopPlan:null});
 }
 return board;
}
export function buttonFixture(mode){return populateButtonWorkload(installedFixture(mode));}
