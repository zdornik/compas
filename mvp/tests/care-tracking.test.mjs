import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clinicalNoteInput,clinicalNotePage} from '../server/clinical-notes.mjs';
import {rosterOptions} from '../server/care-roster.mjs';
import {validateEntry} from '../server/validation.mjs';
import {dayKey} from '../src/domain.js';
test('doctor comments require bounded text, known method, date and optimistic revision',()=>{
 const input={id:randomUUID(),expectedRevision:0,kind:'psychotherapy',method:'cbt',day:dayKey(),title:' Тема ',body:' Наблюдение '};
 assert.equal(clinicalNoteInput(input).body,'Наблюдение');
 for(const patch of [{id:'bad'},{expectedRevision:-1},{kind:'diagnosis'},{method:'invented'},{day:'2100-01-01'},{body:''},{body:'x'.repeat(20001)},{title:'x'.repeat(121)}])assert.throws(()=>clinicalNoteInput({...input,...patch}));
 assert.throws(()=>clinicalNotePage(new URLSearchParams({before:'tampered'}),Buffer.alloc(32),'link:doctor'));
});
test('roster filters and page sizes are bounded',()=>{
 assert.equal(rosterOptions(new URLSearchParams({q:'  Иван '})).q,'Иван');
 for(const params of [{limit:0},{limit:51},{letter:'ИВ'},{medication:'x'.repeat(121)},{before:'x'.repeat(501)}])assert.throws(()=>rosterOptions(new URLSearchParams(params)));
});
test('daily sleep comments persist with conflict protection and original time',()=>{
 const now=new Date('2026-10-26T12:00:00Z'),input={id:'sleep',type:'sleep',day:'2026-10-26',hours:7,minutes:30,quality:'Хорошо',note:'Личный текст'};
 const first=validateEntry(input,input.id,null,now);assert.equal(first.note,input.note);
 assert.deepEqual(validateEntry(input,input.id,first,new Date('2026-10-26T13:00:00Z')),first,'Identical retries are safe');
 assert.throws(()=>validateEntry({...input,hours:8},input.id,first,now),{status:409});
 const updated=validateEntry({...input,hours:8,expectedUpdatedAt:first.updatedAt},input.id,first,new Date('2026-10-26T13:00:00Z'));assert.equal(updated.at,first.at);assert.equal(updated.hours,8);
 assert.throws(()=>validateEntry({...input,note:'x'.repeat(2001)},input.id,null,now));
 assert.throws(()=>validateEntry({...input,day:'2026-10-25',expectedUpdatedAt:first.updatedAt},input.id,first,now),{status:409});
});
