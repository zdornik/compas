import {useEffect,useState} from 'react';
import {ShieldCheck,SignOut} from '@phosphor-icons/react';

const JOURNAL_POLICY='local-stub-2026-10-20-v1';
const permissionValues=consents=>({healthData:Boolean(consents.healthData),journalProcessing:Boolean(consents.journalProcessing),journalSharing:Boolean(consents.journalSharing),journalAiProcessing:Boolean(consents.journalAiProcessing),...(consents.journalAiProcessing?{providerPolicyVersion:consents.providerPolicyVersion}:{})});

export function AccountPermissions({account,onUpdate,includeHealth=false,hasDoctor}){
 const [value,setValue]=useState(()=>permissionValues(account.consents)),[baseline,setBaseline]=useState(account.consentUpdatedAt),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 useEffect(()=>{setValue(permissionValues(account.consents));setBaseline(account.consentUpdatedAt);},[account.id,account.consentUpdatedAt]);
 const change=next=>{setValue(next);setMessage('');};
 const save=async()=>{setPending(true);setMessage('');setFailed(false);try{await onUpdate({...value,expectedConsentUpdatedAt:baseline});setMessage('Настройки доступа сохранены');}catch(error){setMessage(error.message);setFailed(true);}finally{setPending(false);}};
 const shared=account.consents.healthData&&account.consents.journalProcessing&&account.consents.journalSharing;
 return <section className="account-permissions" aria-label="Разрешения для заметок">
  {includeHealth&&<><label className="account-consent"><input type="checkbox" checked={value.healthData} disabled={pending} onChange={event=>change(event.target.checked?{...value,healthData:true}:{healthData:false,journalProcessing:false,journalSharing:false,journalAiProcessing:false})}/><span>Разрешаю сохранение и использование медицинских сведений в этом локальном прототипе.</span></label><p className="input-hint">Отзыв отключает новые медицинские записи и доступ врача, отменяет будущие приёмы. Сохранённые записи остаются доступны вам; это действие их не удаляет.</p></>}
  {!includeHealth&&<p className="input-hint">{shared?(hasDoctor===false?'Чтение заметок разрешено. Врач получит доступ после подтверждения подключения.':'Подключённым врачам разрешено читать ваши заметки.'):'Сейчас тексты заметок закрыты от врачей.'}</p>}
  {!value.healthData&&!includeHealth&&<p className="input-hint">Сначала разрешите сохранение медицинских сведений в разделе «Настройки и приватность».</p>}
  <label className="account-consent"><input type="checkbox" checked={value.journalSharing} disabled={pending||!value.healthData} onChange={event=>change({...value,journalSharing:event.target.checked,...(event.target.checked?{journalProcessing:true}:{})})}/><span>Разрешаю подключённым врачам читать мои заметки и саммари.</span></label>
  <p className="input-hint">Доступ получат только врачи, чьё подключение вы подтвердили. Разрешение включает обработку текста для показа врачу. Его можно отозвать здесь.</p>
  <label className="account-consent"><input type="checkbox" checked={value.journalAiProcessing} disabled={pending||!value.healthData} onChange={event=>change({...value,journalAiProcessing:event.target.checked,providerPolicyVersion:event.target.checked?JOURNAL_POLICY:undefined,...(event.target.checked?{journalProcessing:true}:{})})}/><span>Разрешаю локальную тестовую обработку новых заметок и создание тестовых саммари.</span></label>
  <p className="input-hint">Работает заглушка, текст не отправляется наружу. Результат не оценивает состояние. Старые записи автоматически не обрабатываются. Для передачи реальной нейросети потребуется новое согласие.</p>
  {includeHealth&&<><label className="account-consent"><input type="checkbox" checked={value.journalProcessing} disabled={pending||!value.healthData} onChange={event=>change({...value,journalProcessing:event.target.checked,...(!event.target.checked?{journalSharing:false,journalAiProcessing:false,providerPolicyVersion:undefined}:{})})}/><span>Разрешаю обработку текстовых записей личного дневника.</span></label><p className="input-hint">Отзыв этого разрешения также отключает чтение заметок врачом и тестовую обработку.</p></>}
  <button className="secondary-button" disabled={pending||JSON.stringify(value)===JSON.stringify(permissionValues(account.consents))} onClick={save}>{pending?'Сохраняем…':'Сохранить разрешения'}</button>
  {message&&<p className={failed?'journal-error':'input-hint'} role={failed?'alert':'status'}>{message}</p>}
 </section>;
}

export function AccountPreferences({account,onUpdate,onSignOut}){
 const [pending,setPending]=useState(false),[message,setMessage]=useState('');
 return <section className="account-preferences"><div className="settings-intro"><ShieldCheck size={24}/><div><h3>{[account.profile?.name,account.profile?.surname].filter(Boolean).join(' ')||'Учётная запись'}</h3><p className="input-hint">{account.email}</p></div></div><p className="input-hint">{account.role==='doctor'?'Квалификация врача и адрес почты пока не подтверждаются.':'Адрес почты пока не подтверждается.'}</p>{account.role==='patient'&&<AccountPermissions account={account} onUpdate={onUpdate} includeHealth/>}{message&&<p className="input-hint" role="status">{message}</p>}<button className="text-button" disabled={pending} onClick={async()=>{setPending(true);try{await onSignOut();}catch(error){setMessage(error.message);setPending(false);}}}><SignOut size={18}/>Выйти из учётной записи</button></section>;
}
