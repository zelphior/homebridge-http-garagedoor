# homebridge-http-garagedoor
Homebridge plugin that creates a GarageDoorOpener which uses configurable HTTP calls to set and get its state.

This plugin can be used as a garage door opener in HomeKit/Homebridge. It creates a Homebridge accessory which uses HTTP calls to open, close and check the status of garage door 
and provides the Service.GarageDoorOpener service to HomeKit.

## Installation

1. Install homebridge using: npm install -g homebridge
2. Install homebridge-http-garagedoor using: 
3. Update your configuration file. See sample-config.json in this repository for a sample. 

## Features
The main function of the module is to proxy HomeKit queries to an arbitrary web API to retrieve and set the status of the garage door. Main features include:
- Configurable HTTP endpoints to use for getting/setting the state, including passing parameters in for of GET or in POST body
- Support for basic HTTP authentication
- Configurable mapping of API response data to HomeKit garage door status to allow custom responses
- Interval polling of the current state to enable real-time notifications even if the garage door has been opend or closed without the use of HomeKit

## Configuration
This module requires that the URLs for getting and setting the garage door state are configured correctly. This has to be done in Homebridge's config.json. 
You can find a sample configuration file in this repository. 

The configuration options are the following:

Configuration example with explanation

```
    "accessories": [
        {
            "accessory": "Http-GarageDoor",
            "name": "Garage Door",
            "username": "",
            "password": "",
            "immediately": false,
            "polling": true,
            "pollInterval": 30000,
            "http_method": "POST",
            "urls": {
                "readCurrentState": { "url": "http://localhost:1880/garage/check", "body": "" },
                "readTargetState": { "url": "http://localhost:1880/garage/check", "body": "" },
                "open": { "url": "http://localhost:1880/garage/setstate", "body": "OPEN" },
                "close": { "url": "http://localhost:1880/garage/setstate", "body": "CLOSED" },
            },
            "mappers": [
                {
                    "type": "xpath",
                    "parameters": {
                        "xpath": "string(/state/datapoint/@value)"
                    }
                },
                {
                    "type": "regex",
                    "parameters": {
                        "regexp": "^The door is currently (OPEN|CLOSED), yo!$",
                        "capture": "1"
                    }
                },
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "OPENING": "2",
                            "CLOSING": "3"
                        }
                    }
                }
            ]
        }
    ]

```

- The **name** parameter determines the name of the garage door you will see in HomeKit.
- The **username/password** configuration can be used to specify the username and password if the remote webserver requires HTTP authentication. 
- **debug** turns on debug messages. The important bit is that it reports the mapping process so that it's easier to debug
- The **http_method** can be either "GET" or "POST". The HTTP requests going to the target webserver will be using this method.
- The **urls section** configures the URLs that are to be called on certain events. 
  - The **open** and **close** URLs are called when HomeKit is instructed to open or close the garage door
  - The **readCurrentState** is used by HomeKit for querying the current state of the garage door. It should return the following values in the body of the HTTP response:
    - **"0"**: open
    - **"1"**: closed
    - **"2"**: opening
    - **"3"**: closing
    - **"4"**: stopped
  - The **readTargetState** are used by HomeKit for querying the target state of the garage door. It should return the following values in the body of the HTTP response:
    - **"0"**: open
    - **"1"**: closed
- The **polling** is a boolean that specifies if the current state should be pulled on regular intervals or not. Defaults to false.
- **pollInterval** is a number which defines the poll interval in milliseconds. Defaults to 30000.
- The **mappings** optional parameter allows the definition of several response mappers. This can be used to translate the response received by readCurrentState and readTargetState to the expect 0...4 range expected by homekit

## Response mapping

The mappings block of the configuration may contain any number of mapper definitions. The mappers are chained after each other,  the result of a mapper is fed into the input of the next mapper. The purpose of this whole chain is to somehow boil down the response received from the API to a single number which is expected by Homekit. 

Each mapper has the following JSON format:

```
{
    "type": "<type of the mapper>",
    "parameters": { <parameters to be passed to the mapper> }
}
```

There are 3 kinds of mappers implemented at the moment. 

### Static mapper

The static mapper can be used to define a key => value dictionary. It will simply look up the input in the dictionary and if it is found, it returns the corresponding value. It's great for mapping string responses like "ARMED" to their actual number. 

Configuration is as follows:

```
{
    "type": "static",
    "parameters": {
        "mapping": {
            "OPENING": "2",
            "CLOSING": "3",
			"whataever you don't like": "whatever you like more"
        }
    }
}
```

This configuration would map OPENING to 2, CLOSE to 1 and "whatever you don't like" to "whatever you like more". If the mapping does not have an entry which corresponds to input, it returns the full input. 

### Regexp mapper

The regexp mapper can be used to define a regular expression to run on the input, capture some substring of it and return it. It's great for mapping string responses which may change around but have a certain part that's always there and which is the part you are interested in. 

Configuration is as follows:

```
{
    "type": "regex",
    "parameters": {
        "regexp": "^The door is currently (OPEN|CLOSED), yo!$",
        "capture": "1"
    }
}
```

This configuration will run the regular expression defined by the ***regexp*** parameter against the input and return the first capture group (as defined by ***capture***). So, in this case, if the input is "The garage door is currenty OPEN, yo!", the mapper will map this to "ARMED".

If the regexp does not match the input, the mapper returns the full input. 

### XPath mapper

The XPath mapper can be used to extract data from an XML document. It allows the definition of an XPath which will then be applied to the input and returns whatever the query selects. 

When using this mapper, make sure that you select text elements and not entire nodes or node lists, otherwise it will fail horribly.

Configuration is as follows:

```
{
    "type": "xpath",
    "parameters": {
        "xpath": "//partition[3]/text()",
        "index": 0
    }
}
```

Let's assume this mapper gets the following input:

```
<?xml version="1.0" encoding="ISO-8859-1"?>
<partitionsStatus>
    <partition>OPEN</partition>
    <partition>OPEN</partition>
    <partition>OPENING</partition>
</partitionsStatus>
```

In this case this mapper will return "OPENING". The ***index*** parameter can be used to specify which element to return if the xpath selects multiple elements. In the example above it is completely redundant as partition[3] already makes sure that a single partition is selected. 
