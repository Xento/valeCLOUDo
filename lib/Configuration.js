const fs = require("fs");
const Tools = require("./Tools");
const path = require("path");
const util = require('util');

/**
 * @constructor
 */
const Configuration = function() {
    this.location = process.env.VALETUDO_CONFIG ? process.env.VALETUDO_CONFIG : "config.json";
    this.settings = {
        "spots": [],
        "areas": [],
        "ztimers": [],
        "mqtt" : {
            enabled: false,
            identifier: "rockrobo",
            topicPrefix: "valetudo",
            autoconfPrefix: "homeassistant",
            broker_url: "mqtt://user:pass@foobar.example",
            provideMapData: true,
            caPath: "",
            qos: 0
        },
        "dummycloud": {
            spoofedIP: "203.0.113.1",
            bindIP: "127.0.0.1"
        },
        "webInterface": {
            localization: "en",
            hideMapReload: true,
            style: ""
        },
        "httpAuth": {
            enabled: false,
            username: "valetudo",
            password: "valetudo"
        },
        "telegramBot": {
            enabled: false,
            token: "",
            password: "",
            host: "",
            proxy: "",
            clients: [],
            sendConsumables: true,
            sendConsumablesEvery: false
        },
        "smarthomeAPI": {
            username: "",
            password: "",
            deviceId: "00000000",
            clientId: Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 6),
            deviceip: "127.0.0.1",
            token: "00000000000000000000000000000000",
            server: "de",
            roboname: ""
        },
        "allowSSHKeyUpload": true,
        "map_upload_host": "http://127.0.0.1"
    };

    /* load an existing configuration file. if it is not present, create it using the default configuration */
    if (fs.existsSync(this.location)) {
        console.log(new Date(), "Loading configuration file:", this.location);
        try {
            this.settings = Object.assign(this.settings, JSON.parse(fs.readFileSync(this.location)));
            this.persist();
        } catch(e) {
            console.error(new Date(), "Invalid configuration file!");
            console.log(new Date(), "Writing new file using defaults");

            this.persist();
        }
    } else {
        console.log(new Date(), "No configuration file present. Creating one at:", this.location);
        Tools.MK_DIR_PATH(path.dirname(this.location));
        this.persist();
    }
};

/**
 *
 * @param key {string}
 * @returns {*}
 */
Configuration.prototype.get = function(key) {
    //return this.settings[key];

    if(Array.isArray(this.settings[key]))
        return this.settings[key];
    else {
        var t = new SubConfiguration(this, key);
        return t;
    }
};

Configuration.prototype.getAll = function() {
    return this.settings;
};

/**
 *
 * @param key {string}
 * @param val {string}
 */
Configuration.prototype.set = function(key, val) {
    this.settings[key] = val;

    this.persist();
};

Configuration.prototype.persist = function() {
    fs.writeFileSync(this.location, JSON.stringify(this.settings, null, 2));
};

const SubConfiguration = function (config, subsetting){
    
    var self = this;
    for (let [key, value] of Object.entries(config.settings[subsetting])) {
        Object.defineProperty (self, key, {
            get: function () { 
                return config.settings[subsetting][key];
            },
            set: function (new_value) {
                config.settings[subsetting][key] = new_value;
            }
        });

    }
}

/*SubConfiguration.prototype.toString = function () {
    
    return JSON.stringify(this.toJSON());
}*/

SubConfiguration.prototype[util.inspect.custom] = function(depth, options) {
    return this.toString();
  }

SubConfiguration.prototype.toJSON = function(){
    var json = {};
    for (key of Object.getOwnPropertyNames(this)) {
        json[key] = this[key];
    }

    return json;
}

module.exports = Configuration;
