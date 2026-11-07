'use strict';

// DJI's HTTPS convention: every response is {code, message, data}; Pilot 2 shows
// "(resp.code)" for 5xx. `error` is kept for callers written before the envelope.
// The code mirrors the HTTP status.
function fail(res,status,message){
  return res.status(status).json({code:status,message,data:{},error:message});
}
module.exports={fail};
