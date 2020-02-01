const request = require('request')
const j = request.jar()
const querystring = require('querystring');
const TreeMap = require("treemap-js");
const fs = require("fs");
const zlib = require("zlib");
var stream = require('stream');
var Dummycloud = require('./miio/Dummycloud')

var crypto = require('crypto');

var ssecurity = "";
var servicetoken = "";
var userId = "";
var mapUrlCache = [];

const SmarthomeAPI = function(options) {
  const self = this;

  this.configuration = options.configuration;
  this.vacuum = options.vacuum;
  this.cloud = options.cloud;
  
  this.smarthomeAPIConfig = this.configuration.get("smarthomeAPI");
}

function encodePassword(password) {
  return crypto.createHash('md5').update(password).digest("hex").toUpperCase();
}

function parseJson(data) {
  if(data.includes("&&&START&&&"))
    return JSON.parse(data.replace("&&&START&&&", ""));
  else
    return false;
}

function generateSignature(path, params) {
  var nonce = crypto.randomBytes(16)
  nonce.writeInt32LE(new Date().getTime() / 60000);
  nonce = nonce.toString('base64');

  var b = Buffer.from(crypto.randomBytes(8));
  var millis = Buffer.allocUnsafe(4);
  millis.writeUInt32BE(Math.round(new Date().getTime() / 60000));
  nonce = Buffer.concat([b,millis]).toString('base64');
  
  var signature = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(ssecurity, "base64"), Buffer.from(nonce, "base64")])).digest("base64");

  var paramsTreeMap = new TreeMap();

  params.forEach(element => {
    paramsTreeMap.set(element.key, element.value);
  });

  var paramsArray = Array();
  if (path != null) {
    paramsArray.push(path);
  }

  paramsArray.push(signature);
  paramsArray.push(nonce);
  
  if (paramsTreeMap.getLength() > 0) {	            
    paramsTreeMap.each(function (value, key) {
      paramsArray.push(key+"="+value);
    });
  } else {
      paramsArray.push("data=");
  }

  var postData = "";
  paramsArray.forEach(function(value){
    if(postData != ""){
      postData += "&";
    }

    postData += value;
  });

  body = {
   "signature": HashHmacSHA256(postData, signature),
   "_nonce": nonce
  };

  paramsTreeMap.each(function (value, key) {
    body[key] = value;
  });
  return body;
}

function HashHmacSHA256(data, secret){
  var hmac = crypto.createHmac('sha256',Uint8Array.from(Buffer.from(secret, "base64")));
  //passing the data to be hashed
  data = hmac.update(data);
  //Creating the hmac in the required format
  return data.digest('base64');
}

SmarthomeAPI.prototype.login = function () {
  var self = this;
  return new Promise(function(resolve, reject) {

    if(servicetoken) {
      resolve(true);
      return;
    }

    // Set the headers for the request
    var headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Android-7.1.1-1.0.0-ONEPLUS A3010-136-9D28921C354D7 APP/xiaomi.smarthome APPV/62830',
        'Cookie': "sdkVersion=accountsdk-18.8.15; userId="+self.smarthomeAPIConfig.username+"; deviceId="+self.smarthomeAPIConfig.deviceId
    };

    // Configure the request
    var options = {
        url: "https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true",
        method: 'GET',
        headers: headers,
        gzip: true
    };

    // Start the request
    request(options, function (error, response, body) {
        if (!error && response.statusCode === 200) {
            // Print out the response body
            //console.log({status: 0, statusDsc: "success", data: body});
            var jsonData = parseJson(body);

            if(jsonData == false) {
              reject("Failed to get sign variable");
              return;
            }

            headers.Cookie = "sdkVersion=accountsdk-18.8.15; deviceId="+self.smarthomeAPIConfig.deviceId;

            var options = {
              url: "https://account.xiaomi.com/pass/serviceLoginAuth2",
              method: 'POST',
              headers: headers,
              form : {
                  'sid': "xiaomiio",
                  'hash': encodePassword(self.smarthomeAPIConfig.password),
                  'callback': "https://sts.api.io.mi.com/sts",
                  'qs': "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
                  'user': self.smarthomeAPIConfig.username,
                  '_sign': jsonData._sign,
                  '_json': "true"
              },
              gzip: true
            };

            //headers.length = postBody.length;
            request(options, function (error, response, body) {
              if (!error && response.statusCode === 200) {
                // Print out the response body
                //console.log({status: 0, statusDsc: "success", data: body});
                var jsonData = parseJson(body);
      
                if(jsonData == false) {
                  reject("Login failed");
                  return;
                }

                ssecurity = jsonData.ssecurity;
                userId = jsonData.userId;
                cUserId = jsonData.cUserId;

                const j= request.jar()
                var options = {
                  url: jsonData.location,
                  method: 'GET',
                  headers: headers,
                  gzip: true,
                  jar: j
                };

                request(options, function (error, response, body) {
                  if (!error && response.statusCode === 200) {
                    const cookies = j.getCookies("https://sts.api.io.mi.com/");
                    
                    var found = false;
                    cookies.forEach(cookie => {
                      if(cookie.key == "serviceToken") {
                        servicetoken = cookie.value;
                        found =  true;
                        //console.log(servicetoken);
                        resolve(true);
                        return;
                      }
                    });

                    if(!found){
                      reject("Token cookie not found");
                      return;
                    }

                  } else {
                    reject("HTTP error when getting token cookie");
                    console.log({status: 2, statusDsc: JSON.stringify(error)});
                  }
                });
              } else {
                  reject("HTTP error when logging in");
                  console.log({status: 2, statusDsc: JSON.stringify(error)});
              }
          });
        } else {
            reject("HTTP error when getting _sign")
            console.log({status: 2, statusDsc: JSON.stringify(error)});
        }
    });
  });
}

SmarthomeAPI.prototype.updateMap = function(dontRetry) {
  var self = this;

  if(dontRetry == true && servicetoken != undefined) {
    return;
  }

  self.vacuum.getMapV1(function(error, mapRes){
    if(mapRes != undefined && mapRes[0] != 'retry'){
      
      var unixtime = Math.floor(new Date() / 1000);
      if(mapUrlCache[mapRes[0]] == undefined || mapUrlCache[mapRes[0]].expires > (unixtime - 60)){
        getMapURL.call(self, mapRes[0]).then(function(result){
          
          mapUrlCache[mapRes[0]] = {
            expires: result.result.expires_time,
            url: result.result.url
          };

          downloadMap.call(self, mapUrlCache[mapRes[0]].url);
        }).catch(function(error){
          console.log(error);
          if(!dontRetry) {
            self.login().then(function(reponse){
              self.updateMap(true);
            }).catch(function(){});
          }
        });
      }
      else {
        downloadMap.call(this, mapUrlCache[mapRes[0]].url);
      }
    }
  });
}

SmarthomeAPI.prototype.getDeviceStatus = function (obj) {
  var self = this;

  return new Promise(function(resolve, reject) {

    self.login().then(function(resp){
      var url = "https://"+self.smarthomeAPIConfig.server+".api.io.mi.com/app/home/device_list";
      var headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
        'User-Agent': 'Android-7.1.1-1.0.0-ONEPLUS A3010-136-9D28921C354D7 APP/xiaomi.smarthome APPV/62830',
        'Cookie': "userId="+userId+"; yetAnotherServiceToken="+servicetoken+"; serviceToken="+servicetoken+"; locale=de_DE; timezone=GMT%2B01%3A00; is_daylight=1; dst_offset=3600000; channel=MI_APP_STORE", 
      }

      var params = [{ 
        key: "data",
        //value: '{"dids":["117978555"]}'
        value: obj
      }];

      var body = generateSignature("/home/device_list", params);

      var options = {
        url: url,
        method: 'POST',
        headers: headers,
        form: body,
        gzip: true
      };

      request(options, function (error, response, body) {
        if (!error && response.statusCode === 200) {
          var json = JSON.parse(response.body);
          if(json.message == "ok")
            resolve(json.result.list);
          else
            reject(json.message);
          /*if(json.message == "ok") {
            resolve(json);
          }
          else {
            servicetoken = undefined;
            reject(json.message);
          }*/
          return;
        }

        console.log(response);
        servicetoken = undefined;
        reject("HTTP ERROR");
      });
    }).catch(function(){});
  });
}

function getMapURL(mapName) {
  var self = this;

  return new Promise(function(resolve, reject) {
    var url = "https://"+self.smarthomeAPIConfig.server+".api.io.mi.com/app/home/getmapfileurl";
    var headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
      'User-Agent': 'Android-7.1.1-1.0.0-ONEPLUS A3010-136-9D28921C354D7 APP/xiaomi.smarthome APPV/62830',
      'Cookie': "userId="+userId+"; yetAnotherServiceToken="+servicetoken+"; serviceToken="+servicetoken+"; locale=de_DE; timezone=GMT%2B01%3A00; is_daylight=1; dst_offset=3600000; channel=MI_APP_STORE", 
    }
    
    var params = [{ 
      key: "data",
      value: '{"obj_name":"'+mapName+'"}'
    }];

    var body = generateSignature("/home/getmapfileurl", params);

    var options = {
      url: url,
      method: 'POST',
      headers: headers,
      form: body,
      gzip: true
    };
    
    request(options, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        var json = JSON.parse(response.body);
        
        if(json.message == "ok") {
          resolve(json);
        }
        else {
          console.log("Error when receiving mapurl")
          servicetoken = undefined;
          reject(json.message);
        }
        return;
      }

      var json = JSON.parse(response.body);
      servicetoken = undefined;
      console.log(response);

      reject(json.message);
    });
  });
}

function downloadMap(url){
  var self = this;
  
  var options = {
    url: url,
    method: 'GET',
    gzip: false
  };
  //console.log(url);

  /*request(options, function (error, response, body) {
    console.log(response.headers);
    
  }).pipe(request.put("http://127.0.0.1/api/miio/map_upload_handler"));
  return;
*/
  request(options, function (error, response, body) {
    //console.log(response.headers);
  }).pipe(request.put("http://127.0.0.1/api/miio/map_upload_handler"));
}

module.exports = SmarthomeAPI;