/** Consume keepalives without treating an interrupted stream as a completed estimate. */
export async function readJamieEstimateStream(response:Response):Promise<unknown> {
  if(!response.body)throw new Error('Jamie’s connection closed. Reopen Jamie to recover a completed result.')
  const reader=response.body.getReader(),decoder=new TextDecoder()
  let buffer=''
  try {
    while(true){
      const {done,value}=await reader.read()
      buffer+=decoder.decode(value,{stream:!done})
      let boundary:number
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2)
        for(const line of frame.split('\n')){
          if(!line.startsWith('data: '))continue
          const event=JSON.parse(line.slice(6))
          if(event.type==='error')throw new Error(event.error || 'Jamie could not finish this estimate.')
          if(event.type==='result')return event.result
        }
      }
      if(done)break
    }
    throw new Error('Jamie’s connection closed before the result arrived. Reopen Jamie to recover a completed result; your live estimate has not changed.')
  } finally {reader.releaseLock()}
}
