import assert from 'node:assert/strict';
import {fixture as installedFixture} from './installed-client-fixture.mjs';
export const TASK_COUNT=400;
export function populateButtonWorkload(board,{role='active',taskCount=TASK_COUNT}={}){
 assert.ok(['active','sole','exhausted'].includes(role),'Reviewed400-task fixture role');
 assert.ok(Number.isSafeInteger(taskCount)&&taskCount>0&&taskCount<=TASK_COUNT,'Reviewed button fixture task count');
 assert.ok(Array.isArray(board.tasks)&&board.tasks.length>0&&board.tasks.length<=taskCount,'Supported task source for button fixture');
 const template=board.tasks.at(-1);
 while(board.tasks.length<taskCount){
  const index=board.tasks.length;
  board.tasks.push({...structuredClone(template),id:'gate-load-'+index,title:'Gate400 workload task '+index,createdAt:10000+index,done:role!=='active',completedAt:role==='active'?null:10000,lastDoneAt:role==='active'?null:10000,ctx:[],due:null,startsAt:null,prerequisites:[],woopPlan:null});
 }
 return board;
}
export function buttonFixture(mode,{profile='workload-diagnostic'}={}){
 assert.ok(['ordinary','workload-diagnostic'].includes(profile),'Unknown button fixture profile');
 const board=installedFixture(mode);
 return profile==='ordinary'?board:populateButtonWorkload(board);
}
