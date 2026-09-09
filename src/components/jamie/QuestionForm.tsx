import {useEffect,useState} from 'react'
import {serializeAnswers,type JamieQuestion} from '../../../supabase/functions/_shared/jamieQuestions.ts'

export function QuestionForm({questions,onSubmit,busy=false,draftKey}:{draftKey?:string;questions:JamieQuestion[];onSubmit:(text:string)=>Promise<unknown>;busy?:boolean}) {
  const key=draftKey ? `jamie-answers:${draftKey}:${questions.map(q=>q.id).join('|')}` : null
  const [saved]=useState(()=>{try{return key ? JSON.parse(sessionStorage.getItem(key) ?? '{}') : {}}catch{return {}}})
  const [answers,setAnswers]=useState<Record<string,string>>(saved.answers ?? {})
  const [notes,setNotes]=useState(saved.notes ?? '')
  useEffect(()=>{try{if(key)sessionStorage.setItem(key,JSON.stringify({answers,notes}))}catch{/* Keep in-memory answers when storage is unavailable. */}},[key,answers,notes])
  const [review,setReview]=useState(false)
  const [sending,setSending]=useState(false)
  const complete=questions.every(q=>!!answers[q.id]?.trim())
  const disabled=busy || sending
  return <section className="mt-4 space-y-4 text-base text-gray-900" aria-label="Questions for this work">
    {review ? <>
      <h3 className="font-semibold">Review your answers</h3>
      <dl className="space-y-3">{questions.map(q=><div key={q.id}><dt className="font-medium">{q.prompt}</dt><dd className="whitespace-pre-wrap">{answers[q.id]}</dd></div>)}</dl>
      {notes && <p className="whitespace-pre-wrap">Additional notes: {notes}</p>}
      <button type="button" disabled={disabled} className="rounded border px-4 py-2" onClick={()=>setReview(false)}>Edit answers</button>{' '}
      <button type="button" disabled={disabled || !complete} className="rounded bg-brand-navy px-4 py-3 text-white disabled:opacity-40" onClick={async()=>{setSending(true);try{await onSubmit(serializeAnswers(questions,answers,notes))}finally{setSending(false)}}}>{sending?'Sending…':'Send confirmed answers'}</button>
    </> : <>
      <h3 className="font-semibold">A few details before Jamie prices</h3>
      {questions.map((q,index)=><fieldset key={q.id} disabled={disabled} className="rounded-lg border border-blue-200 bg-white p-3">
        <legend className="px-1 font-medium">{index+1}. {q.prompt}</legend>
        {q.choices.length>0 && <div className="my-2 flex flex-wrap gap-2">{q.choices.map(choice=><label key={choice} className="flex items-center gap-2 rounded border px-3 py-2"><input type="radio" name={q.id} checked={answers[q.id]===choice} onChange={()=>setAnswers({...answers,[q.id]:choice})}/>{choice}</label>)}</div>}
        <textarea aria-label={q.prompt} value={answers[q.id] ?? ''} rows={2} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})} placeholder={q.kind==='measurement'?'Enter quantity and units, e.g. 120 SF. If unknown, say what needs measuring.':'Your answer — choose above or write your own.'} className="w-full rounded border border-gray-400 px-3 py-2 text-base"/>
      </fieldset>)}
      <label className="block">Anything else Jamie should know?<textarea value={notes} onChange={e=>setNotes(e.target.value)} disabled={disabled} rows={2} className="mt-1 w-full rounded border border-gray-400 px-3 py-2"/></label>
      <button type="button" disabled={disabled || !complete} onClick={()=>setReview(true)} className="rounded bg-brand-navy px-4 py-3 text-white disabled:opacity-40">Review answers</button>
    </>}
  </section>
}
