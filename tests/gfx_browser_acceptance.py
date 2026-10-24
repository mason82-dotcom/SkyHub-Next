#!/usr/bin/env python3
"""Real Chromium acceptance with synthetic DJI fixtures. No real SkyHub/Internet I/O."""
from __future__ import annotations
import base64
import json
import os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from time import time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
WEBROOT=ROOT/"frontend"/"public"
LEAFLET=Path(os.environ["SKYHUB_TEST_LEAFLET_DIST"]).resolve()
ARTIFACTS=ROOT/"artifacts"/"gfx-browser"
TILE=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3t8AAAAASUVORK5CYII=")
SOCKET_STUB="""(() => {
  window.__skyhubTestSockets=[];
  window.io=function(){
    const handlers={};
    const socket={
      on(key,handler){handlers[key]=handler;return this;},
      disconnect(){this.disconnected=true;},
      emitFixture(key,value){if(handlers[key])handlers[key](value);}
    };
    window.__skyhubTestSockets.push(socket);
    return socket;
  };
})();"""

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(WEBROOT),**kwargs)
    def log_message(self,*_args):
        pass

def check(value,message):
    if not value: raise AssertionError(message)

def fixtures(now):
    def sample(sn,model,battery,altitude,age):
        fields=["battery","altitude","horizontalSpeed","heading","verticalSpeed","linkQuality","attitudePitch","attitudeRoll"]
        return {
          "sn":sn,"modelName":model,"deviceCategory":"aircraft","role":"aircraft",
          "aircraftConnected":True,"lastSeenAt":now,"lastTelemetryAt":now,
          "lastPositionAt":now,"positionTimeVerified":True,"telemetryTimeVerified":True,
          "telemetry":{"battery":battery,"altitude":altitude,"horizontalSpeed":0,
                       "heading":270,"verticalSpeed":-0.5,"linkQuality":4,
                       "attitudePitch":12.5,"attitudeRoll":-20,
                       "latitude":49.1,"longitude":8.6},
          "telemetryFieldAt":{**{f:now-1000 for f in fields},"altitude":now-age},
          "telemetryFieldTimeVerified":{f:True for f in fields}
        }
    return [sample("SYN-A1","SYNTHETIC Mavic 3M",74,35.5,50000),
            sample("SYN-B2","SYNTHETIC Matrice 4T",53,0,1000)]

def guard(page,base,fixture,unexpected):
    def route_request(route):
        url=route.request.url
        if url.startswith(base+"/"):
            if route.request.method!="GET":
                unexpected.append("Non-GET to local fixture");route.abort()
            elif "/api/devices" in url:
                route.fulfill(status=200,content_type="application/json",body=json.dumps(fixture))
            elif "/api/health" in url:
                route.fulfill(status=200,content_type="application/json",body='{"mqtt":false,"subscribed":false}')
            elif "/api/events" in url or "/api/drone/" in url:
                route.fulfill(status=200,content_type="application/json",body="[]")
            elif url.endswith("/socket.io/socket.io.js"):
                route.fulfill(status=200,content_type="application/javascript",body=SOCKET_STUB)
            else: route.continue_()
            return
        if url=="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js":
            route.fulfill(path=str(LEAFLET/"leaflet.js"),content_type="application/javascript")
        elif url=="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css":
            route.fulfill(path=str(LEAFLET/"leaflet.css"),content_type="text/css")
        elif url.endswith("marker-icon.png") or url.endswith("marker-shadow.png"):
            route.fulfill(path=str(LEAFLET/"images"/url.split("/")[-1]),content_type="image/png")
        elif url.startswith("https://tile.openstreetmap.org/") or (url.startswith("https://") and ".tile.openstreetmap.org/" in url):
            route.fulfill(status=200,body=TILE,content_type="image/png")
        else:
            unexpected.append("Unexpected outbound request blocked");route.abort()
    page.route("**/*",route_request)

def watermark(page):
    page.evaluate("""() => {
      const n=document.createElement('div');
      n.textContent='SYNTHETIC / OFFLINE BROWSER TEST';
      n.setAttribute('aria-hidden','true');
      Object.assign(n.style,{position:'fixed',zIndex:'2000',left:'12px',bottom:'10px',
        font:'700 10px Consolas,monospace',padding:'6px 8px',
        color:'#fff',background:'#9a2143',pointerEvents:'none'});
      document.body.appendChild(n);
    }""")

def main():
    for file in ("index.html","gfx-cockpit.js","telemetry-freshness.js","hyperframes-gfx.css"):
        check((WEBROOT/file).is_file(),"Frontend asset missing: "+file)
    check((LEAFLET/"leaflet.js").is_file(),"Local pinned Leaflet missing")
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    fixture=fixtures(int(time()*1000))
    with ThreadingHTTPServer(("127.0.0.1",0),Handler) as httpd:
        Thread(target=httpd.serve_forever,daemon=True).start()
        base=f"http://127.0.0.1:{httpd.server_port}"
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=["--no-sandbox"])
            try:
                context=browser.new_context(viewport={"width":1365,"height":850})
                page=context.new_page()
                errors=[];unexpected=[]
                page.on("pageerror",lambda error:errors.append(str(error)))
                guard(page,base,fixture,unexpected)
                page.goto(base+"/",wait_until="load")
                page.wait_for_function("() => document.querySelector('#gfxCockpitDevice').options.length===2")
                check(page.locator(".leaflet-container").count()==1,"Leaflet map missing")
                check(page.locator("#gfxCockpitBattery").inner_text()=="74 %","Battery fixture missing")
                check(page.locator("#gfxTimelineList li").count()==0,
                      "Initial field snapshot must not create fabricated history")
                check(page.locator("#gfxTimelineSummary").text_content().startswith("0 von maximal 24"),
                      "Empty timeline digest must start at zero")
                check(page.locator("#gfxQualityCurrent").inner_text()=="7",
                      "Initial fixture: seven of eight instrument fields should be current")
                check(page.locator("#gfxQualityStale").inner_text()=="1",
                      "Initial fixture: altitude stale field missing in quality summary")
                check(page.locator("#gfxQualityMissing").inner_text()=="0",
                      "Initial fixture: no missing instrument fields expected")
                check("7 von 8" in page.locator("#gfxQualitySummary").inner_text(),
                      "Quality summary must state scope, not flight readiness")
                check("Veraltet" in page.locator("#gfxCockpitAltitudeAge").inner_text(),
                      "Old altitude should be marked stale")
                check(page.locator("#gfxCockpitAltitude").inner_text()=="35,5 m",
                      "Stale value must remain visible with warning")
                check(page.locator("#gfxCockpitBatteryMeter").evaluate(
                    "el=>parseFloat(el.style.width)")>0,"Fresh verified battery meter missing")
                check(page.locator("#gfxCockpitLocate").is_enabled(),"Map location button disabled")
                check(page.locator('a[href="/wpml-editor.html"]').count()==1,"Duplicate module link")
                check(page.locator("#gfxCockpitTitle").inner_text()=="Fluginstrumente",
                      "Cockpit heading must not be overwritten by numeric DJI heading")
                check(page.locator("#gfxCockpitHeading").inner_text()=="270 °",
                      "DJI heading value must render into its own instrument")
                check(page.locator("#gfxCockpitAttitude").is_visible(),
                      "Both fresh verified attitude fields should display the horizon")
                check(page.locator("#gfxCockpitAttitudePlane").evaluate(
                    "el => el.style.transform") == "rotate(20deg) translateY(10px)",
                    "Pitch/roll scene transform differs from fixture values")
                check(page.locator("#gfxCockpitPitch").inner_text()=="12,5 °",
                      "Reported pitch is missing or incorrectly formatted")
                check(page.locator("#gfxCockpitCompass").is_visible(),
                      "Fresh verified heading must show a real-data compass")
                check(page.locator("#gfxCockpitNeedle").evaluate(
                    "el => el.style.transform") == "rotate(270deg)",
                    "Heading compass bearing does not match DJI fixture")
                # Preserve a verified/fresh attitude screenshot before introducing stale values.
                watermark(page)
                page.screenshot(path=str(ARTIFACTS/"gfx-1365-attitude-fresh-synthetic.png"),full_page=True)
                page.locator("#gfxCockpitDevice").select_option("SYN-B2")
                check(page.locator("#gfxCockpitAltitude").inner_text()=="0,0 m","Real zero missing")
                check(page.locator("#gfxQualityCurrent").inner_text()=="8",
                      "Device selection must recompute all eight independent field statuses")
                page.evaluate("""() => window.__skyhubTestSockets.at(-1).emitFixture('device_update',{
                    sn:'SYN-B2',modelName:'SYNTHETIC Matrice 4T',aircraftConnected:true,
                    lastSeenAt:Date.now(),lastTelemetryAt:Date.now(),
                    telemetry:{battery:52,altitude:0,horizontalSpeed:0,heading:270,
                      verticalSpeed:0,linkQuality:4,latitude:49.1,longitude:8.6},
                    lastPositionAt:Date.now(),positionTimeVerified:true,
                    telemetryFieldAt:{battery:Date.now(),altitude:Date.now(),
                      horizontalSpeed:Date.now(),heading:Date.now(),verticalSpeed:Date.now(),
                      linkQuality:Date.now()},
                    telemetryFieldTimeVerified:{battery:true,altitude:true,horizontalSpeed:true,
                      heading:true,verticalSpeed:true,linkQuality:true}
                  })""")
                check(page.locator("#gfxCockpitDevice").input_value()=="SYN-B2",
                      "Device selection lost on incremental OSD")
                check(page.locator("#gfxCockpitBattery").inner_text()=="52 %",
                      "New OSD field not rendered")
                # Selecting SYN-B2 starts a fresh baseline; a changed battery
                # source timestamp must appear as an observed provenance change.
                page.locator("#gfxCockpitTimeline summary").click()
                check(page.locator("#gfxTimelineList li").count()>0,
                      "Incremental telemetry update should produce field provenance observations")
                check(page.locator("#gfxTimelineList li").count()<=24,
                      "Timeline must remain bounded to 24 observations")
                check(page.locator("#gfxTimelineList").inner_text().find("Feldzeitpunkt")>=0,
                      "Verified fresh source timestamp advancement was not observed")
                check(page.locator("#gfxTimelineSummary").inner_text().find("Feldzeitpunkt-Fortschreibungen")>=0,
                      "Digest must distinguish confirmed source timestamps from status transitions")
                check(page.locator("#gfxTimelineTop li").count()==0,
                      "Source timestamp updates must not count as stale transitions")
                page.locator("#gfxTimelineClear").click()
                check(page.locator("#gfxTimelineList li").count()==0,
                      "Clearing local history must remove all observations")
                check(page.locator("#gfxTimelineSummary").text_content().startswith("0 von maximal 24"),
                      "Clearing the list must also clear its diagnostic digest")
                check(page.locator("#gfxTimelineTop li").count()==0,
                      "Clearing the list must reset the ranked stale fields")
                check(page.locator("#gfxQualityCurrent").inner_text()=="6",
                      "Incremental update should have only six of eight current fields")
                check(page.locator("#gfxQualityMissing").inner_text()=="2",
                      "Missing pitch/roll after update must be counted as missing")
                # A stale heading must remove the compass, not suggest a live course.
                page.evaluate("""() => {
                  const s=window.__skyhubTestSockets.at(-1);
                  s.emitFixture('device_update',{
                    sn:'SYN-B2',modelName:'SYNTHETIC Matrice 4T',aircraftConnected:true,
                    lastSeenAt:Date.now(),lastTelemetryAt:Date.now(),
                    telemetry:{battery:52,altitude:0,horizontalSpeed:0,heading:270,
                      verticalSpeed:0,linkQuality:4,latitude:49.1,longitude:8.6},
                    lastPositionAt:Date.now(),positionTimeVerified:true,
                    telemetryFieldAt:{battery:Date.now(),altitude:Date.now(),
                      horizontalSpeed:Date.now(),heading:Date.now()-35000,
                      verticalSpeed:Date.now(),linkQuality:Date.now()},
                    telemetryFieldTimeVerified:{battery:true,altitude:true,horizontalSpeed:true,
                      heading:true,verticalSpeed:true,linkQuality:true}
                  });
                }""")
                check(page.locator("#gfxCockpitAttitude").is_hidden(),
                      "Horizon must hide when updated device lacks both verified pitch/roll fields")
                check(page.locator("#gfxCockpitPitchAge").inner_text()=="Nicht empfangen",
                      "Missing pitch must not be represented as current")
                check(page.locator("#gfxCockpitCompass").is_hidden(),
                      "Stale heading must not display an active compass needle")
                check("Veraltet" in page.locator("#gfxCockpitHeadingAge").inner_text(),
                      "Stale heading provenance missing")
                # One field stays fresh while roll becomes stale. Keep text,
                # hide only the schematic flight-attitude geometry.
                page.evaluate("""() => {
                  window.__skyhubTestSockets.at(-1).emitFixture('device_update',{
                    sn:'SYN-B2',modelName:'SYNTHETIC Matrice 4T',aircraftConnected:true,
                    lastSeenAt:Date.now(),lastTelemetryAt:Date.now(),
                    telemetry:{battery:52,altitude:0,horizontalSpeed:0,heading:270,
                      verticalSpeed:0,linkQuality:4,latitude:49.1,longitude:8.6,
                      attitudePitch:8,attitudeRoll:-15},
                    lastPositionAt:Date.now(),positionTimeVerified:true,
                    telemetryFieldAt:{battery:Date.now(),altitude:Date.now(),
                      horizontalSpeed:Date.now(),heading:Date.now(),
                      verticalSpeed:Date.now(),linkQuality:Date.now(),
                      attitudePitch:Date.now(),attitudeRoll:Date.now()-32000},
                    telemetryFieldTimeVerified:{battery:true,altitude:true,
                      horizontalSpeed:true,heading:true,verticalSpeed:true,
                      linkQuality:true,attitudePitch:true,attitudeRoll:true}
                  });
                }""")
                check(page.locator("#gfxCockpitPitch").inner_text()=="8,0 °",
                      "Fresh pitch should remain visible")
                check(page.locator("#gfxCockpitRoll").inner_text()=="-15,0 °",
                      "Stale roll must retain its reported numeric value")
                check(page.locator("#gfxCockpitRollAge").get_attribute("data-kind")=="stale",
                      "Stale roll provenance should remain explicit")
                check(page.locator("#gfxCockpitAttitude").is_hidden(),
                      "Single stale roll must hide the artificial horizon")
                check("Veraltet" in page.locator("#gfxTimelineList").inner_text(),
                      "Source status transitions must be logged without claiming packet loss")
                check(page.locator("#gfxTimelineTop li").count()==2,
                      "Heading and roll should be the two observed stale transitions")
                check("Kurs / Heading" in page.locator("#gfxTimelineTop").inner_text(),
                      "Stale heading not reflected in digest")
                check("Rollwinkel" in page.locator("#gfxTimelineTop").inner_text(),
                      "Stale roll not reflected in digest")
                check("2 Wechsel" in page.locator("#gfxTimelineSummary").inner_text(),
                      "Digest counts must reflect observed stale transitions only")
                check(page.locator("#gfxQualityStale").inner_text()=="1",
                      "Stale roll must count in quality panel")
                check(page.locator("#gfxQualityCurrent").inner_text()=="7",
                      "Remaining seven instrument fields must remain current")
                page.locator("#gfxMapFocus").click()
                check(page.locator("#gfxMapFocus").get_attribute("aria-pressed")=="true",
                      "Map focus toggle failed")
                page.locator("#gfxMapFocus").click()
                page.locator("#tabTak").click()
                check(page.locator("#gfxCockpit").is_hidden(),"TAK overlays cockpit")
                page.locator("#tabOperations").click()
                page.keyboard.press("/")
                check(page.locator("#deviceSearch").evaluate("el=>document.activeElement===el"),
                      "Keyboard slash shortcut broken")
                page.screenshot(path=str(ARTIFACTS/"gfx-1365-synthetic.png"),full_page=True)
                for width,height in ((375,812),(320,640)):
                    page.set_viewport_size({"width":width,"height":height})
                    geo=page.evaluate("""() => {
                      const z=document.querySelector('.leaflet-control-zoom')?.getBoundingClientRect();
                      const t=document.querySelector('.map-tools')?.getBoundingClientRect();
                      if(!z||!t)return {separate:false,reason:'missing-rect'};
                      const rect=r=>({top:Math.round(r.top),bottom:Math.round(r.bottom),
                                     left:Math.round(r.left),right:Math.round(r.right)});
                      return {separate:z.bottom <= t.top || t.bottom <= z.top ||
                               z.right <= t.left || t.right <= z.left,
                              zoom:rect(z),toolbar:rect(t),
                              toolbarTop:getComputedStyle(document.querySelector('.map-tools')).top};
                    }""")
                    check(geo["separate"],
                          "Leaflet zoom and map tools intersect at "+str(width)+
                          " / geometry="+repr(geo))
                    check(page.locator("#gfxCockpit").is_visible(),"Cockpit absent on mobile")
                    check(page.locator("#gfxQualitySummary").is_visible(),
                          "Instrument-quality status not visible on mobile at "+str(width))
                    check(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 2"),
                          "Horizontal document overflow at "+str(width))
                    page.screenshot(path=str(ARTIFACTS/f"gfx-{width}-synthetic.png"),full_page=True)
                    page.locator("#gfxCockpitDevice").select_option("SYN-A1")
                    check(page.locator("#gfxTimelineList li").count()==0,
                          "Switching instrument devices must not leak previous device timeline")
                    check(page.locator("#gfxTimelineTop li").count()==0,
                          "Switching devices must also clear the stale-field ranking")
                    check(page.locator("#gfxCockpitAttitude").is_visible(),
                          "Fresh, verified artificial horizon must be visible at "+str(width))
                    page.screenshot(path=str(ARTIFACTS/f"gfx-{width}-attitude-fresh-synthetic.png"),
                                    full_page=True)
                    page.locator("#gfxCockpitDevice").select_option("SYN-B2")
                check(not errors,"Browser JS errors: "+repr(errors))
                check(not unexpected,"Unexpected traffic: "+repr(unexpected))
                context.close()
                ctx=browser.new_context(viewport={"width":390,"height":780},reduced_motion="reduce")
                reduced=ctx.new_page();errors=[];unexpected=[]
                reduced.on("pageerror",lambda error:errors.append(str(error)))
                guard(reduced,base,fixture,unexpected)
                reduced.goto(base+"/",wait_until="load")
                reduced.locator("#gfxMotionToggle").wait_for(state="visible")
                check(reduced.locator("#gfxMotionToggle").is_disabled(),
                      "Reduced motion override must be blocked")
                check(reduced.locator("body").get_attribute("data-gfx-motion")=="off",
                      "Reduced motion not respected")
                check(not errors and not unexpected,"Reduced-motion browser errors/traffic")
                ctx.close()
                # No JavaScript: the legacy header module navigation remains
                # available while purely interactive GFX buttons stay hidden.
                no_js=browser.new_context(viewport={"width":375,"height":780},
                                          java_script_enabled=False)
                static_page=no_js.new_page();errors=[];unexpected=[]
                static_page.on("pageerror",lambda error:errors.append(str(error)))
                guard(static_page,base,fixture,unexpected)
                static_page.goto(base+"/",wait_until="load")
                check(static_page.locator('header a[href="/wpml-editor.html"]').is_visible(),
                      "Module navigation fallback missing without JavaScript")
                check(static_page.locator("#gfxMotionToggle").is_hidden(),
                      "Inert motion button shown without JavaScript")
                check(static_page.locator('.gfx-module-rail').count()==0,
                      "Script-added module rail must not exist without JS")
                check(not errors and not unexpected,"No-JS browser errors/traffic")
                no_js.close()

                # Forced-colors must override decorative animations and retain
                # keyboard focus / readable labels without changing telemetry.
                high_contrast=browser.new_context(viewport={"width":390,"height":780},
                                                  forced_colors="active")
                hc=high_contrast.new_page();errors=[];unexpected=[]
                hc.on("pageerror",lambda error:errors.append(str(error)))
                guard(hc,base,fixture,unexpected)
                hc.goto(base+"/",wait_until="load")
                hc.locator("#gfxMotionToggle").wait_for(state="visible")
                check(hc.locator("#gfxMotionToggle").is_disabled(),
                      "Forced colors must block GFX animations")
                check(hc.locator("body").get_attribute("data-gfx-motion")=="off",
                      "Forced-colors preference ignored")
                hc.wait_for_function(
                    "() => document.querySelector('#gfxCockpitDevice').options.length===2"
                )
                check(hc.locator("#gfxCockpitBattery").inner_text()=="74 %",
                      "Forced-colors mode lost instrument text")
                check(not errors and not unexpected,"Forced-colors browser errors/traffic")
                high_contrast.close()
                print("GFX isolated Chromium: PASS (desktop, 375px, 320px, reduced motion, no-JS, forced-colors)")
            finally: browser.close()

if __name__=="__main__":
    main()
