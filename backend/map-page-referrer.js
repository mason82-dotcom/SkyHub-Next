'use strict';

// OpenStreetMap's web tile policy requires an Origin/Referer for browser tiles.
// Only these two public, offline drawing pages may send their HTTPS origin.
// Sensitive API and Pilot 2 responses keep the server-wide no-referrer policy.
const MAP_PAGES=new Set(['/wpml-editor.html','/wpml-survey-preview.html']);
const MAP_REFERRER_POLICY='strict-origin-when-cross-origin';

function mapPageReferrerPolicy(req,res,next){
  if((req.method==='GET'||req.method==='HEAD')&&MAP_PAGES.has(req.path)){
    res.set('Referrer-Policy',MAP_REFERRER_POLICY);
  }
  next();
}

module.exports={mapPageReferrerPolicy,MAP_PAGES,MAP_REFERRER_POLICY};
