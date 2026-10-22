import {test} from 'node:test';import assert from 'node:assert/strict';
import {loadSavedAttendance,saveAttendance} from '../src/saved-attendance';
const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)},removeItem:(k:string)=>{m.delete(k)},m}};
const record={startedAt:'2026-10-22T09:00:00',captures:2,manual:{b:true},observations:[{id:'1',image:'data:big',studentId:'a'},{id:'2',image:'data:face',suggestion:'c'}]};
test('Today\'s attendance survives a refresh and drops recognised thumbnails',()=>{const s=memory();saveAttendance(record,s);const r=loadSavedAttendance(new Date('2026-10-22T11:00:00'),s)!;assert.equal(r.captures,2);assert.deepEqual(r.manual,{b:true});assert.equal(r.observations[0].image,'');assert.equal(r.observations[1].image,'data:face')});
test('A previous day\'s attendance is never restored',()=>{const s=memory();saveAttendance(record,s);assert.equal(loadSavedAttendance(new Date('2026-10-23T09:00:00'),s),undefined);assert.equal(s.m.size,0)});
test('Corrupt saved data is ignored',()=>{const s=memory();s.setItem('eigenroll-attendance-v1','{oops');assert.equal(loadSavedAttendance(new Date(),s),undefined)});
