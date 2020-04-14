const fs = require("fs");
const Vacuum = require("./miio/Vacuum");
const Dummycloud = require("./miio/Dummycloud");
const Webserver = require("./webserver/WebServer");
const MqttClient = require("./MqttClient");
const Configuration = require("./Configuration");
const EventEmitter = require('events');
const SSHManager = require('./SSHManager');
const Telegrambot = require('./Telegrambot'); 
const CronScheduler = require('./CronScheduler');
const SmarthomeAPI = require('./SmarthomeAPI');

const Valetudo = function() {
    var self = this;
    this.configuration = new Configuration();
    this.address = Valetudo.VAC_ADDRESS_PROVIDER();
    this.events = new EventEmitter(); //TODO: Better naming?
    this.model = Valetudo.VACUUM_MODEL_PROVIDER();

    this.tokenProvider = function() {
        return Buffer.from(self.configuration.get("smarthomeAPI").token, "hex");
    }

    this.webPort = process.env.VAC_WEBPORT ? parseInt(process.env.VAC_WEBPORT) : 80;
    this.map = {bin: null, hash: null};

    this.dummycloud = new Dummycloud({
        spoofedIP: this.configuration.get("dummycloud").spoofedIP,
        cloudKey: Valetudo.CLOUD_KEY_PROVIDER(),
        deviceId: this.configuration.get("smarthomeAPI").deviceId,
        bindIP: this.configuration.get("dummycloud").bindIP,
        mapUploadHost: this.configuration.get("map_upload_host"),
        events: this.events
    });

    this.vacuum = new Vacuum({
        ip: this.configuration.get("smarthomeAPI").deviceip,
        tokenProvider: this.tokenProvider,
        model: this.model,
        events: this.events
    });

    this.smarthomeapi = new SmarthomeAPI({
        configuration: this.configuration,
        vacuum: this.vacuum,
        events: this.events,
        map: this.map,
        cloud: this.dummycloud
    });

    this.sshManager = new SSHManager();

    this.cronScheduler = new CronScheduler({
        configuration: this.configuration,
        vacuum: this.vacuum,
    });

    this.telegramBot = new Telegrambot({
        vacuum: this.vacuum,
        events: this.events,
        map: this.map,
        configuration: this.configuration
    });

    this.webserver = new Webserver({
        vacuum: this.vacuum,
        port: this.webPort,
        configuration: this.configuration,
        events: this.events,
        map: this.map,
        sshManager: this.sshManager,
        cronScheduler: this.cronScheduler,
        events: this.events,
        cloud: this.dummycloud, 
        telegramBot: this.telegramBot,
        smarthomeAPI: this.smarthomeapi
    });

    /*this.smarthomeapi.login().then(function(result){
        setInterval(function(){
            self.smarthomeapi.updateMap();
        }, 2000);
    });*/
    

    if(this.configuration.get("mqtt") && this.configuration.get("mqtt").enabled === true) {
        this.mqttClient = new MqttClient({
            configuration: this.configuration,
            vacuum: this.vacuum,
            events: this.events,
            map: this.map
        });
    }
};

function readValueFromDeviceConf(key) {
    let deviceConf;
    try {
        deviceConf = fs.readFileSync("device.conf");
    } catch(e) {
        console.error(e);
    }

    if(deviceConf) {
        const value = deviceConf.toString().match(new RegExp("^"+ key + "=(.*)$", "m"));

        if(Array.isArray(value) && value[1]) {
            // noinspection JSConstructorReturnsPrimitive
            return value[1];
        } else {
            console.error("Failed to fetch " + key + " from device.conf");
        }
    } else {
        console.error("Failed to read device.conf");
    }
}
Valetudo.VAC_ADDRESS_PROVIDER = function() {
    if(process.env.VAC_ADDRESS) {
        // noinspection JSConstructorReturnsPrimitive
        return process.env.IP;
    } else {
        const ip = readValueFromDeviceConf("VAC_ADDRESS");

        // noinspection JSConstructorReturnsPrimitive
        return ip ? ip: "127.0.0.1"; //This doesnt work but it wont crash the system
    }
};

Valetudo.NATIVE_TOKEN_PROVIDER = function() {
    if(process.env.VAC_TOKEN) {
        // noinspection JSConstructorReturnsPrimitive
        return process.env.VAC_TOKEN;
    } else {
        var token = readValueFromDeviceConf("TOKEN");

        // noinspection JSConstructorReturnsPrimitive
        token = token ? token: "0000000000000000"; //This doesnt work but it wont crash the system
        
        return Buffer.from(token, "hex");
    }
};

Valetudo.CLOUD_KEY_PROVIDER = function() {
	if(process.env.VAC_CLOUDKEY) {
		// noinspection JSConstructorReturnsPrimitive
		return process.env.VAC_CLOUDKEY;
	} else {
		const cloudKey = readValueFromDeviceConf("key");

		// noinspection JSConstructorReturnsPrimitive
		return cloudKey ? cloudKey : "0000000000000000"; //This doesnt work but it wont crash the system
	}
};

Valetudo.DEVICE_ID_PROVIDER = function() { //TODO: merge with CLOUD_KEY_PROVIDER
	if(process.env.VAC_DID) {
		// noinspection JSConstructorReturnsPrimitive
		return process.env.VAC_DID;
	} else {
		const did = readValueFromDeviceConf("did");

		// noinspection JSConstructorReturnsPrimitive
		return did ? did: "00000000"; //This doesnt work but it wont crash the system
	}
};

Valetudo.VACUUM_MODEL_PROVIDER = function() {
	if(process.env.VAC_MODEL) {
		return process.env.VAC_MODEL;
	} else {
		const model = readValueFromDeviceConf("model");

		return model ? model : "rockrobo.vacuum.v1";
	}
};

module.exports = Valetudo;
