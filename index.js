var Service, Characteristic;
var request = require("request");
var xpath = require("xpath");
var dom = require("xmldom").DOMParser;
var pollingtoevent = require("polling-to-event");

module.exports = function(homebridge){
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory("homebridge-http-garagedoor", "Http-GarageDoor", HttpGarageDoorAccessory);
};

/**
 * Mapper class that can be used as a dictionary for mapping one value to another
 *
 * @param {Object} parameters The parameters of the mapper
 * @constructor
 */
function StaticMapper(parameters) {
	var self = this;
	self.mapping = parameters.mapping;

	self.map = function(value) {
		return self.mapping[value] || value;
	};
}

/**
 * Mapper class that can extract a part of the string using a regex
 *
 * @param {Object} parameters The parameters of the mapper
 * @constructor
 */
function RegexMapper(parameters) {
	var self = this;
	self.regexp = new RegExp(parameters.regexp);
	self.capture = parameters.capture || "1";

	self.map = function(value) {
		var matches = self.regexp.exec(value);

		if (matches !== null && self.capture in matches) {
			return matches[self.capture];
		}

		return value;
	};
}

/**
 * Mapper class that uses XPath to select the text of a node or the value of an attribute
 *
 * @param {Object} parameters The parameters of the mapper
 * @constructor
 */
function XPathMapper(parameters) {
	var self = this;
	self.xpath = parameters.xpath;
	self.index = parameters.index || 0;

	self.map = function(value) {
		var document = new dom().parseFromString(value);
		var result  = xpath.select(this.xpath, document);

		if (typeof result == "string") {
			return result;
		} else if (result instanceof Array && result.length > self.index) {
			return result[self.index].data;
		}

		return value;
	};
}

/**
 * The main class acting as the garage door Accessory
 *
 * @param log The logger to use
 * @param config The config received from HomeBridge
 * @constructor
 */
function HttpGarageDoorAccessory(log, config) {
	var self = this;
	self.log = log;
	self.name = config["name"];

	// the service
	self.garagedoorService = null;

	// debug flag
	self.debug = config.debug;

	// polling settings
	self.polling = config.polling;
	self.pollInterval = config.pollInterval || 30000;

	// cached values
	self.previousCurrentState = null;
	self.previousTargetState = null;

	// process the mappers
	self.mappers = [];
	if (config.mappers) {
		config.mappers.forEach(function(matches) {
			switch (matches.type) {
				case "regex":
					self.mappers.push(new RegexMapper(matches.parameters));
					break;
				case "static":
					self.mappers.push(new StaticMapper(matches.parameters));
					break;
				case "xpath":
					self.mappers.push(new XPathMapper(matches.parameters));
					break;
			}
		});
	}

	// url info
	self.urls = {
		readCurrentState: {
			url: config.urls.readCurrentState.url,
			body: config.urls.readCurrentState.body || ""
		},
		readTargetState: {
			url: config.urls.readTargetState.url,
			body: config.urls.readTargetState.body || ""
		},
		open: {
			url: config.urls.open.url,
			body: config.urls.open.body || ""
		},
		close: {
			url: config.urls.close.url,
			body: config.urls.close.body || ""
		}
		//,
		//readObstructionState: {
		//	url: config.urls.readObstructionState.url,
		//	body: config.urls.readObstructionState.body || ""
		//}
	};

	self.httpMethod = config["http_method"] || "GET";
	self.auth = {
		username: config.username || "",
		password: config.password || "",
		immediately: true
	};

	if ("immediately" in config) {
		self.auth.immediately = config.immediately;
	}

	// initialize
	self.init();
}

/**
 * Initializer method, fired after the config has been applied
 */
HttpGarageDoorAccessory.prototype.init = function() {
	var self = this;
	// set up polling if requested
	if (self.polling) {
		self.log("Starting polling with an interval of %s ms", self.pollInterval);
		var emitter = pollingtoevent(function (done) {
			self.getCurrentState(function (err, result) {
				done(err, result);
			});
		}, { longpolling: true, interval: self.pollInterval });

		emitter.on("longpoll", function (state) {
			self.log("Polling noticed status change to %s, notifying devices", state);
			if (state == 2) {
				self.garagedoorService
				.getCharacteristic(Characteristic.TargetDoorState)
				.setValue(0);
				}
			else if (state == 3) {
				self.garagedoorService
				.getCharacteristic(Characteristic.TargetDoorState)
				.setValue(1);
				}
			self.garagedoorService
				.getCharacteristic(Characteristic.CurrentDoorState)
				.setValue(state);
		});
		
		emitter.on("err", function(err) {
			self.log("Polling failed, error was %s", err);
		});
	}
};

/**
 * Method that performs a HTTP request
 *
 * @param url The URL to hit
 * @param body The body of the request
 * @param callback Callback method to call with the result or error (error, response, body)
 */
HttpGarageDoorAccessory.prototype.httpRequest = function(url, body, callback) {
	request({
		url: url,
		body: body,
		method: this.httpMethod,
		auth: {
			user: this.auth.username,
			pass: this.auth.password,
			sendImmediately: this.auth.immediately
		},
		headers: {
			Authorization: "Basic " + new Buffer(this.auth.username + ":" + this.auth.password).toString("base64")
		}
	},
	function(error, response, body) {
		callback(error, response, body)
	});
};

/**
 * Logs a message to the HomeBridge log
 *
 * Only logs the message if the debug flag is on.
 */
HttpGarageDoorAccessory.prototype.debugLog = function () {
	if (this.debug) {
		this.log.apply(this, arguments);
	}
};

/**
 * Sets the target state of the garagedoor device to a given state
 *
 * @param state The state to set
 * @param callback Callback to call with the result
 */
HttpGarageDoorAccessory.prototype.setTargetState = function(state, callback) {
	this.log("Setting target state to %s", state);
	var cfg = null;
	switch (state) {
		case Characteristic.TargetDoorState.OPEN:
			cfg = this.urls.open;
			break;
		case Characteristic.TargetDoorState.CLOSED:
			cfg = this.urls.close;
			break;
	}

	var url = cfg.url;
	var body = cfg.body;
	if (url) {
		this.httpRequest(url, body, function(error, response) {
			if (error) {
				this.log("SetState function failed: %s", error.message);
				callback(error);
			} else {
				this.log("SetState function succeeded!");
				callback(error, response, state);
			}
		}.bind(this));
	} else {
		callback(null);
	}
};

/**
 * Applies the mappers to the state string received
 *
 * @param {string} string The string to apply the mappers to
 * @returns {string} The modified string after all mappers have been applied
 */
HttpGarageDoorAccessory.prototype.applyMappers = function(string) {
	var self = this;

	if (self.mappers.length > 0) {
		self.debugLog("Applying mappers on " + string);
		self.mappers.forEach(function (mapper, index) {
			var newString = mapper.map(string);
			self.debugLog("Mapper " + index + " mapped " + string + " to " + newString);
			string = newString;
		});

		self.debugLog("Mapping result is " + string);
	}

	return string;
};

/**
 * Gets the state of the garage door from a given URL
 *
 * @param {string} url The URL to poke for the result
 * @param {string} body The body of the request
 * @param {Function} callback The method to call with the results
 */
HttpGarageDoorAccessory.prototype.getState = function(url, body, callback) {
	if (!url) {
		callback(null);
	}

	this.httpRequest(url, body, function(error, response, responseBody) {
		if (error) {
			this.log("GetState function failed: %s", error.message);
			callback(error);
		} else {
			var state = responseBody;
			state = this.applyMappers(state);
			callback(null, parseInt(state));
		}
	}.bind(this));
};

/**
 * Gets the current state of the garage door
 *
 * @param {Function} callback The method to call with the results
 */
HttpGarageDoorAccessory.prototype.getCurrentState = function(callback) {
	var self = this;
	self.debugLog("Getting current state");
	this.getState(this.urls.readCurrentState.url, this.urls.readCurrentState.body, function(err, state) {
		self.debugLog("Current state is %s", state);
		if (self.previousCurrentState !== state) {
			self.previousCurrentState = state;
			self.log("Current state changed to %s", state);
		}

		callback(err, state);
	});
};

/**
 * Gets the target state of the garage door
 *
 * @param {Function} callback The method to call with the results
 */
HttpGarageDoorAccessory.prototype.getTargetState =  function(callback) {
	var self = this;
	self.debugLog("Getting target state");
	this.getState(this.urls.readTargetState.url, this.urls.readTargetState.body, function(err, state) {
		self.debugLog("Target state is %s", state);
		if (self.previousTargetState !== state) {
			self.previousTargetState = state;
			self.log("Target state changed to %s", state);
		}

		callback(err, state);
	});
};

/**
 * Identifies the garage door (?)
 *
 * @param {Function} callback The method to call with the results
 */
HttpGarageDoorAccessory.prototype.identify = function(callback) {
	this.log("Identify requested!");
	callback();
};

/**
 * Returns the services offered by this garage door
 *
 * @returns {Array} The services offered
 */
HttpGarageDoorAccessory.prototype.getServices =  function() {
	this.garagedoorService = new Service.GarageDoorOpener(this.name);

	this.garagedoorService
		.getCharacteristic(Characteristic.CurrentDoorState)
		.on("get", this.getCurrentState.bind(this));

	this.garagedoorService
		.getCharacteristic(Characteristic.TargetDoorState)
		.on("get", this.getTargetState.bind(this))
		.on("set", this.setTargetState.bind(this));

	return [ this.garagedoorService ];
};
