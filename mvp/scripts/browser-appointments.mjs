import assert from 'node:assert/strict';
import {dayKey} from '../src/domain.js';
import {appointmentDayAfter} from '../src/appointments.js';

export async function browserAppointments(patient,doctor,{pause=async()=>{},revokeDoctor,restoreDoctor}={}){
  const patientNav=patient.getByRole('navigation',{name:'Основная навигация',exact:true});
  const doctorNav=doctor.getByRole('navigation',{name:'Разделы кабинета врача',exact:true});
  await patientNav.getByRole('button',{name:'Врач',exact:true}).click();
  await patient.getByRole('button',{name:'Запросить приём',exact:true}).click();
  await patient.getByLabel('Комментарий к приёму').fill('Синтетический запрос пациента');
  await pause();await patient.getByRole('button',{name:'Отправить запрос',exact:true}).click();
  const requested=patient.locator('.ap-row').filter({hasText:'Синтетический запрос пациента'});
  await requested.getByText('Ожидает подтверждения врача',{exact:true}).waitFor({state:'visible'});await pause();
  await doctorNav.getByRole('button',{name:'Календарь',exact:true}).click();
  const incoming=doctor.locator('.ap-requests .ap-row').filter({hasText:'Синтетический запрос пациента'});
  await incoming.getByRole('button',{name:'Подтвердить',exact:true}).click();
  await requested.getByText('Приём подтверждён',{exact:true}).waitFor({state:'visible'});await pause();
  // The same slot must produce a visible conflict without losing the form draft.
  await doctor.getByRole('button',{name:'Назначить приём',exact:true}).click();
  await doctor.getByLabel('Комментарий к приёму').fill('Синтетическое назначение врача');
  const form=doctor.getByRole('dialog',{name:'Назначить приём',exact:true});
  await form.getByRole('button',{name:'Назначить приём',exact:true}).click();
  await form.getByRole('alert').waitFor({state:'visible'});
  assert.equal(await doctor.getByLabel('Комментарий к приёму').inputValue(),'Синтетическое назначение врача');
  const day=appointmentDayAfter(dayKey(),2);
  await form.getByRole('button',{name:/^Дата приёма:/}).click();
  const picker=doctor.getByRole('dialog',{name:'Выбрать: Дата приёма',exact:true});
  while(!await picker.locator('[data-date="'+day+'"]').count())await picker.getByRole('button',{name:'Следующий месяц',exact:true}).click();
  await picker.locator('[data-date="'+day+'"]').click();await pause();
  await form.getByRole('button',{name:'Назначить приём',exact:true}).click();await form.waitFor({state:'hidden'});
  const scheduled=patient.locator('.ap-row').filter({hasText:'Синтетическое назначение врача'});
  await scheduled.getByText('Приём подтверждён',{exact:true}).waitFor({state:'visible'});await pause();
  if(revokeDoctor){
    await revokeDoctor();await doctor.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await doctor.locator('.ap-calendar-day .journal-error').waitFor({state:'visible'});
    assert.equal(await doctor.locator('.ap-calendar-day .ap-row').count(),0,'Denied reads must clear cached appointments');
    await restoreDoctor();await doctor.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await doctor.locator('.ap-calendar-day .ap-row').filter({hasText:'Синтетическое назначение врача'}).waitFor({state:'visible'});
  }
  await patientNav.getByRole('button',{name:'Сегодня',exact:true}).click();
  await doctorNav.getByRole('button',{name:'Пациенты',exact:true}).click();
  return ['patient request','doctor confirmation','slot conflict preserves draft','direct doctor appointment','patient receives both appointments',...(revokeDoctor?['doctor consent withdrawal clears appointment cache','reapproval refreshes appointments']:[])];
}
