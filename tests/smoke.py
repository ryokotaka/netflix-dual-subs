import asyncio, pathlib
from playwright.async_api import async_playwright
EXT = pathlib.Path(__file__).resolve().parent.parent / 'ext'
VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nWe need to figure it out\nbefore the demo.\n\n00:00:05.000 --> 00:00:08.000\nBy the way, I'm looking forward to it.\n\n00:00:09.000 --> 00:00:12.000\nDon't freak out.\n"
JA = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nデモの前に\n解決しないと\n\n00:00:05.000 --> 00:00:08.000\nところで 楽しみにしてる\n"
STUB = """
window.chrome = { storage:{local:{get:(k,cb)=>cb({}), set:()=>{}}},
  runtime:{ getURL:p=>'https://www.netflix.com/__ext/'+p,
    sendMessage:(m,cb)=>fetch(m.url).then(r=>r.text()).then(t=>cb({ok:true,text:t})) } };
"""
PAGE = """<html><body style="margin:0;background:#222;height:100vh">
<video style="width:100%;height:100%"></video>
<script>
const v=document.querySelector('video'); let t=0, paused=false;
Object.defineProperty(v,'currentTime',{get:()=>t,set:x=>t=x});
Object.defineProperty(v,'paused',{get:()=>paused});
v.pause=()=>{paused=true}; v.play=()=>{paused=false; return Promise.resolve()};
window.__setT=x=>t=x;
window.addEventListener('message',e=>{ if(e.data&&e.data.__nds==='seek') t=e.data.ms/1000; });
</script></body></html>"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1400,'height':800})
        pg.on('console', lambda m: print('console:', m.text))
        pg.on('pageerror', lambda e: print('PAGEERROR:', e))
        async def route(r):
            u = r.request.url
            if '/__ext/' in u: await r.fulfill(path=str(EXT/u.split('/__ext/')[1]))
            elif u.endswith('en.vtt'): await r.fulfill(body=VTT)
            elif u.endswith('ja.vtt'): await r.fulfill(body=JA)
            else: await r.fulfill(body=PAGE, content_type='text/html')
        await pg.route('**/*', route)
        await pg.add_init_script(STUB)
        await pg.add_init_script(path=str(EXT/'inject.js'))
        await pg.goto('https://www.netflix.com/watch/123')
        for f in ['lib.js','content.js']: await pg.add_script_tag(path=str(EXT/f))
        await pg.add_style_tag(path=str(EXT/'styles.css'))
        # simulate Netflix manifest passing through JSON.parse
        await pg.evaluate("""JSON.parse(JSON.stringify({result:{movieId:123,timedtexttracks:[
          {language:'en',rawTrackType:'subtitles',ttDownloadables:{'webvtt-lssdh-ios8':{downloadUrls:{a:'https://x.nflxvideo.net/en.vtt'}}}},
          {language:'ja',rawTrackType:'subtitles',ttDownloadables:{'webvtt-lssdh-ios8':{urls:[{url:'https://x.nflxvideo.net/ja.vtt'}]}}},
          {language:'',isNoneTrack:true}]}}))""")
        await pg.wait_for_timeout(1500)
        await pg.evaluate("__setT(2)"); await pg.wait_for_timeout(500)
        await pg.hover('.nds-w[data-i="4"]'); await pg.wait_for_timeout(400)
        print('paused on hover:', await pg.evaluate("document.querySelector('video').paused"))
        await pg.screenshot(path=str(pathlib.Path(__file__).parent / 'shot1.png'))
        print('rows:', await pg.locator('.nds-row').count(), '| ja:', await pg.inner_text('.nds-ja'))
        await pg.click('.nds-star'); await pg.mouse.move(5,5); await pg.wait_for_timeout(300)
        print('resumed:', not await pg.evaluate("document.querySelector('video').paused"))
        await pg.keyboard.press('d'); await pg.wait_for_timeout(400)
        print('after D, time=', await pg.evaluate("document.querySelector('video').currentTime"), '| en:', await pg.inner_text('.nds-en'))
        await pg.click('[data-tab="saved"]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=str(pathlib.Path(__file__).parent / 'shot2.png'))
        await b.close()
asyncio.run(main())
