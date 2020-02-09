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

var loginFailedCounter = 0;

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

SmarthomeAPI.prototype.login = function (username, password) {
  var self = this;
  
  if(username == undefined) {
    username = self.smarthomeAPIConfig.username;

    servicetoken = null;
    loginFailedCounter = 0;
  }

  if(password == undefined)
    password = self.smarthomeAPIConfig.password;
  else
    servicetoken = null;

  return new Promise(function(resolve, reject) {

    if(username.trim() == "" || password.trim() == "") {
      console.error(new Date(), "Xiaomi Cloud: username or password missing.");
      reject("Xiaomi Cloud username or password missing.");
      return;
    }

    if(servicetoken) {
      resolve(true);
      return;
    }
    else {

      if(loginFailedCounter > 3){
        console.error(new Date(),"Xiaomi Cloud: Logging in failed to many times. Please check your credentials and save them again.")
        reject("Login failed to many times.")
      }

      console.info(new Date(),"Xiaomi Cloud: Logging in");
    }

    // Set the headers for the request
    var headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Android-7.1.1-1.0.0-ONEPLUS A3010-136-9D28921C354D7 APP/xiaomi.smarthome APPV/62830',
        'Cookie': "sdkVersion=accountsdk-18.8.15; userId="+username+"; deviceId="+self.smarthomeAPIConfig.clientId
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
              loginFailedCounter++;
              reject("Failed to get sign variable");
              return;
            }

            headers.Cookie = "sdkVersion=accountsdk-18.8.15; deviceId="+self.smarthomeAPIConfig.clientId;

            var options = {
              url: "https://account.xiaomi.com/pass/serviceLoginAuth2",
              method: 'POST',
              headers: headers,
              form : {
                  'sid': "xiaomiio",
                  'hash': encodePassword(password),
                  'callback': "https://sts.api.io.mi.com/sts",
                  'qs': "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
                  'user': username,
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
      
                if(jsonData.code != 0) {
                  console.error(new Date(),"Xiaomi Cloud: Login failed");
                  loginFailedCounter++;
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
                        console.info(new Date(),"Xiaomi Cloud: Login successful");
                        resolve(true);
                        return;
                      }
                    });

                    if(!found){
                      loginFailedCounter++;
                      reject("Token cookie not found");
                      return;
                    }

                  } else {
                    loginFailedCounter++;
                    reject("HTTP error when getting token cookie");
                    console.error(new Date(), JSON.stringify(error));
                  }
                });
              } else {
                loginFailedCounter++;
                reject("HTTP error when logging in");
                console.log(JSON.stringify(error));
              }
          });
        } else {
          loginFailedCounter++;
          reject("HTTP error when getting _sign")
          console.log(JSON.stringify(error));
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

SmarthomeAPI.prototype.getDeviceStatus = function (username, password, obj) {
  var self = this;

  return new Promise(function(resolve, reject) {

    self.login(username, password).then(function(resp){
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
    }).catch(function(error){
      reject(error);
    });
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