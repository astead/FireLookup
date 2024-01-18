/* *
 * This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
 * Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
 * session persistence, api calls, and more.
 * */
const Alexa = require('ask-sdk-core');
const http_request = require('request');

/**
 * @param {Object} handlerInput Alexa handlerInput object
 * @param {String} permission Alexa Skill permission to check for
 * @returns {Boolean} true if permission is granted. false if it is not
 * @description checks to see if the desired Skill permission is granted
 */
 function isPermissionGranted(handlerInput, permission) {
    const { requestEnvelope: { context: { System: { user } } } } = handlerInput;
    return user.permissions &&
        user.permissions.scopes &&
        user.permissions.scopes[permission] &&
        user.permissions.scopes[permission].status === "GRANTED";
}

const LookupFireHandler = {
    canHandle(handlerInput) {
        return (Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest' ||
            (Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'LookupFire'));
    },
    async handle(handlerInput) {
        const { requestEnvelope, serviceClientFactory, responseBuilder } = handlerInput;
        const request = handlerInput.requestEnvelope.request;
        
        /* Check Location ability and permissions */
        var latitude = -1;
        var longitude = -1;
        var zipcode = -1;
        var zipcountry = -1;

        try {
            const consentToken = requestEnvelope.context.System.user.permissions
                && requestEnvelope.context.System.user.permissions.consentToken;
            if (!consentToken) {
                console.log("Don't have consent token.");

                return responseBuilder
                    .speak('Fire Monitor needs to know your location to lookup the nearest fire.  ' +
                    'Please enable Device Country and Postal Code permissions in the Alexa app.')
                    .withAskForPermissionsConsentCard(['alexa:devices:all:address:country_and_postal_code:read'])
                    .getResponse();
            } else {
                console.log("Have consent token." + consentToken);
            }

            const { deviceId } = requestEnvelope.context.System.device;
            const deviceAddressServiceClient = serviceClientFactory.getDeviceAddressServiceClient();
            const address = await deviceAddressServiceClient.getCountryAndPostalCode(deviceId);

            //console.log('Got info: ' + address.countryCode + "-" + address.postalCode);
            zipcode = address.postalCode;
            zipcountry = address.countryCode;

            if (zipcountry != "US") {
                console.log("Country not supported: country code:" + zipcountry);
                return responseBuilder
                    .speak('Fire monitor is not supported in your current location.')
                    .getResponse();
            }

        } catch (error) {
            console.log("ERROR trying to get zip and country code: " + error.message);

            return responseBuilder
                .speak('Please enable Device Country and Postal Code permissions in the Amazon Alexa app.')
                .withAskForPermissionsConsentCard(['alexa:devices:all:address:country_and_postal_code:read'])
                .getResponse();
        }
        
        if (zipcode != -1) {
            try {
                // Need to convert zip code to latitude and longitude
                //var zip_url = "https://public.opendatasoft.com/api/records/1.0/search/?dataset=us-zip-code-latitude-and-longitude&q=" + zipcode + "&lang=United+States";
                // Dataset: WFIGS - Current Wildland Fire Locations
                // https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-wildland-fire-locations/about
                var zip_url = "https://public.opendatasoft.com/api/records/1.0/search/?dataset=georef-united-states-of-america-zc-point&q=" + zipcode + "&lang=United+States";
                var response = await getHttp(zip_url);
                //console.log("Got the zipcode lat/lon data.");
                if (response.statusCode != 200) {

                    console.log("ERROR trying to get lat/lon of zipcode: " + zipcode);
                    console.log("ERROR message: " + error.message);
                    console.log("ERROR status code: " + response.statusCode);
                    console.log("ERROR response: " + response.body);

                    return responseBuilder
                        .speak("There was an error trying to get the latitude and longitude coordinates for your zipcode." +
                            "  Please let the skill publisher know so they can resolve the issue.")
                        .getResponse();
                } else {
                    var zip_data = JSON.parse(response.body);
                    if (zip_data.records.length == 0) {

                        console.log("ERROR trying to get lat/lon of zipcode: " + zipcode);
                        console.log("ERROR response: " + response.body);
                        console.log("ERROR Zipcode doesn't seem to exist.");
                        console.log("ERROR exited gracefully letting user know location is not supported.");

                        return responseBuilder
                            .speak('Fire monitor is not supported in your current location.')
                            .getResponse();
                    } else {
                        longitude = zip_data.records[0].geometry.coordinates[0];
                        latitude = zip_data.records[0].geometry.coordinates[1];
                    }
                }
            } catch (error) {
                console.log("ERROR trying to get lat/lon of zipcode: " + zipcode);
                console.log("ERROR message: " + error.message);
                console.log("ERROR response: " + response.body);

                return responseBuilder
                    .speak("There was an error trying to get the latitude and longitude coordinates for your zipcode." +
                        "  Please let the skill publisher know so they can resolve the issue.")
                    .getResponse();
            }
        } else {
            console.log("Somehow we don't have a zipcode.");

            return responseBuilder
                .speak("For some reason I could not get your zip code.  " +
                        "Please enable Device Country and Postal Code permissions in the Amazon Alexa app.")
                .withAskForPermissionsConsentCard(['alexa:devices:all:address:country_and_postal_code:read'])
                .getResponse();
        }
        
        var speechOutput = "";

        try {
            // Get fire data
            //OLD DATASET URL: "https://opendata.arcgis.com/datasets/68637d248eb24d0d853342cba02d4af7_0.geojson";
            var url = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/Current_WildlandFire_Locations/FeatureServer/0/query?where=1%3D1&outFields=FireBehaviorGeneral,FireBehaviorGeneral1,InitialLatitude,InitialLongitude,IncidentName,PercentContained,PercentPerimeterToBeContained,DailyAcres,POOCity&outSR=4326&f=json";
            var response = await getHttp(url);
            if (response.statusCode != 200) {

                console.log("ERROR getting fire data.");
                console.log("ERROR website: " + url);
                console.log("ERROR status code: " + response.statusCode);
                console.log("ERROR response: " + response.body);

                return responseBuilder
                    .speak("There was an error trying to get fire data, the national fire data server may be down. " +
                        "Please let the skill publisher know so they can investigate.")
                    .getResponse();
            }
            //console.log("Got the fire data.");
            //console.log(response);
            var fire_data = JSON.parse(response.body);
            var closest_dist = -1.0;
            var closest_i = -1;
            var cur_lat = 0;
            var cur_lon = 0;
            var cur_dist = 0;
            var orig_lat = 0;
            var orig_lon = 0;
            var orig_dist = 0;
            var cur_acres = 0;
            var cur_cont = 0;
            var name = "";
            var city = "";
            var close_fire_count = 0;

            for (i in fire_data.features) {
                if (fire_data.features[i].attributes.PercentContained != 100 && (
                    fire_data.features[i].attributes.FireBehaviorGeneral == "Minimal" ||
                    fire_data.features[i].attributes.FireBehaviorGeneral == "Extreme" ||
                    fire_data.features[i].attributes.FireBehaviorGeneral == "Moderate" ||
                    fire_data.features[i].attributes.FireBehaviorGeneral == "Active")) {

                    cur_lon = fire_data.features[i].geometry.x;
                    cur_lat = fire_data.features[i].geometry.y;
                    cur_dist = get_distance(cur_lat, cur_lon, latitude, longitude);

                    if (closest_i == -1 || cur_dist < closest_dist) {
                        closest_dist = cur_dist;
                        closest_i = i;
                    }

                    if (cur_dist <= 50) {
                        close_fire_count++;
                    }
                }
            }

            if (closest_i != -1) {
                i = closest_i;

                orig_lat = fire_data.features[i].attributes.InitialLatitude;
                orig_lon = fire_data.features[i].attributes.InitialLongitude;
                cur_acres = fire_data.features[i].attributes.DailyAcres;
                if (cur_acres == null) {
                    cur_acres = 0;
                }
                cur_cont = fire_data.features[i].attributes.PercentContained;
                if (cur_cont == null) {
                    cur_cont = 0;
                }
                name = fire_data.features[i].attributes.IncidentName;
                city = fire_data.features[i].attributes.POOCity;
                orig_dist = get_distance(orig_lat, orig_lon, latitude, longitude);
                dist_diff = Math.round(closest_dist) - Math.round(orig_dist);

                /*
                console.log(i + ":" + fire_data.features[i].properties.IncidentName + ":" +
                    orig_lat + ":" + orig_lon + "(" + orig_dist + ")->" +
                    fire_data.features[i].geometry.coordinates[1] + ":" + fire_data.features[i].geometry.coordinates[0] + "(" + cur_dist + ")");
                */

                if (close_fire_count == 1) {
                    speechOutput = "There is " + close_fire_count + " uncontained fire within 50 miles.  ";
                } else {
                    speechOutput = "There are " + close_fire_count + " uncontained fires within 50 miles.  ";
                }
                speechOutput += "The closest uncontained fire is the " + name + " fire.  ";
                if (city != null) {
                    speechOutput += "It is in " + city + ", and ";
                } else {
                    speechOutput += "It ";
                }
                speechOutput += " is " + Math.round(closest_dist) + " mile";
                if (Math.round(closest_dist) != 1) {
                    speechOutput += "s";
                }
                speechOutput += " from your zip code.  ";
                speechOutput += "It has burned " + Math.round(cur_acres) + " acre";
                if (cur_acres != 1) {
                    speechOutput += "s";
                }
                speechOutput += ", and is " + Math.round(cur_cont) + " percent contained.  ";


                if (dist_diff > 0) {
                    speechOutput = speechOutput + " Since it started, it is " + Math.round(dist_diff) + " mile";
                    if (dist_diff != 1) {
                        speechOutput += "s";
                    }
                    speechOutput += " further away from your zip code. ";
                }
                if (dist_diff < 0) {
                    speechOutput = speechOutput + " Since it started, it is " + Math.round(-1 * dist_diff) + " mile";
                    if (dist_diff != -1) {
                        speechOutput += "s";
                    }
                    speechOutput += " closer to your zip code. ";
                }
            } else {
                speechOutput = "There are no active uncontained fires based on the National Interagency Fire Center.  ";
            }

            //console.log(speechOutput);

            return handlerInput.responseBuilder
                .speak(speechOutput)
                .getResponse();
            }
            catch (error) {
                console.log("Error getting fire data:" + error.message);
    
                return handlerInput.responseBuilder
                    .speak("There was a general error. Please let the skill publisher know.")
                    .getResponse();
            }
    }
};

function get_distance(lat1, lon1, lat2, lon2) {

    const R = 3958.8; // miles
    const ang1 = lat1 * Math.PI / 180; // ?, ? in radians
    const ang2 = lat2 * Math.PI / 180;
    const ang_lat = (lat2 - lat1) * Math.PI / 180;
    const ang_lon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(ang_lat / 2) * Math.sin(ang_lat / 2) +
        Math.cos(ang1) * Math.cos(ang2) *
        Math.sin(ang_lon / 2) * Math.sin(ang_lon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c; // in miles

    return d;
}

function getHttp(url) {
    return new Promise((resolve, reject) => {

        const req = http_request.get(url, (error, response, body) => {
            if (error) {
                console.log('error:', error); // Print the error if one occurred
            }
            if (response && response.statusCode != 200) {
                console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
            }
            resolve({
                "statusCode": response.statusCode,
                "body": body
            });
        });
        req.on('error', (e) => {
            console.log("HTTP_Request Error: " + e.message);
            reject({
                "statusCode": -1,
                "body": e.message
            });
        });
    });
}

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'You can say hello to me! How can I help?';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speakOutput = 'Goodbye!';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};
/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet 
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Sorry, I don\'t know about that. Please try again.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};
/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.';
        console.log(`~~~~ Error handled: ${JSON.stringify(error)}`);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom 
 * */
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LookupFireHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();