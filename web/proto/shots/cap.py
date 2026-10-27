import asyncio, json, sys, os, subprocess
from playwright.async_api import async_playwright
OUT='/workspace/olo-proto-shots'; BASE='http://127.0.0.1:8765/'
PAGES=[(d,p) for d in 'abc' for p in ['home','character','intro']]
only=sys.argv[1:] 
async def main():
  res={}
  async with async_playwright() as pw:
    b=await pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist'])
    for d,p in PAGES:
      name=f'{d}-{p}'
      if only and name not in only: continue
      dur=32 if p=='intro' else 9
      ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=1,record_video_dir=f'{OUT}/raw',record_video_size={'width':390,'height':844})
      pg=await ctx.new_page(); errs=[]
      pg.on('console',lambda m: m.type=='error' and errs.append(m.text)); pg.on('pageerror',lambda e: errs.append(str(e)))
      await pg.goto(BASE+name+'.html'+('?demo=1' if p=='home' else ''))
      shots=[3,6] if p!='intro' else [3,9,14,19,22,27,30]
      t=0; fps=[]
      for s in shots:
        await pg.wait_for_timeout((s-t)*1000); t=s
        await pg.screenshot(path=f'{OUT}/{name}-{s:02d}s.png')
        fps.append(await pg.evaluate('window.__m? window.__m.fps():-1'))
      await pg.wait_for_timeout(max(0,dur-t)*1000)
      v=pg.video; await ctx.close(); src=await v.path()
      subprocess.run(['ffmpeg','-y','-loglevel','error','-i',src,'-c:v','libx264','-pix_fmt','yuv420p','-crf','26',f'{OUT}/{name}.mp4'])
      res[name]={'fps':[round(x,1) for x in fps],'errors':errs[:5]}
      print(name,res[name],flush=True)
    await b.close()
  json.dump(res,open(f'{OUT}/perf.json','w'),ensure_ascii=False,indent=1)
asyncio.run(main())
