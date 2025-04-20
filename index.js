/*
 * Copyright 2024 Raffaele Montella <raffaele.montella@uniparthenope.it>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The uuid library
const uuidv4 = require('uuid/v4');

// The geographic library
const geolib = require('geolib')

// Define the subscription period
const subscriptionPeriod = 1000

/*
 Define the plugin
 app - passed by the framework, is the reference to the application
*/
module.exports = function (app) {


  // The POB notification object
  let mobNotification = null

  // The next waypoint
  let nextPoint = null

  // Define the plugin object and the list of the Signal K update the plugin subscribes to
  let plugin = {

    // The plugin unique id
    id: 'mob-signalk-plugin',

    // The plugin human-readable name
    name: 'SignalK POB',

    // The plugin description
    description: 'Men Over Board Signal K server plugin',

    // Subscribes
    unsubscribes: []
  }

  // logError - log error on the application logging system or on the console
  const logError =
    app.error ||
    (err => {
      console.error(err)
    })

  // debug - write debug messages on the application debug log or on the console
  const debug =
    app.debug ||
    (msg => {
      console.log(msg)
    })

  // The plugin schema representing metadata and settings
  plugin.schema = {
    type: "object",
    title: "POB",
    description: "Manage POB data.",
    properties: {
    }
  }

  /*
  Define the start function (invoked by the framework when the plugin have to be started)
  options - passed by the framework, has the properties defined in plugin.schema.properties
  */
  plugin.start = function (options) {

    // Subscribe to the mob alarm
    app.subscriptionmanager.subscribe(

        // Subscription
        {
          context: 'vessels.self',
          subscribe: [
            {
              path: 'notifications.mob',
              period: subscriptionPeriod
            }]
        },

        // Reference data structure
        plugin.unsubscribes,

        // Executed in with an error
        (err) => {

          // Return the error
          app.error(err)

          // Set the provider error
          app.setProviderError(err)
        },

        // Executed when a delta is available
        (delta) => {

          // Check if the update array is available
          if (delta.updates) {

            // For each update in the update array...
            delta.updates.forEach((update) => {

              // Check if the values array is available
              if (update.values) {

                // For each value in the values array...
                update.values.forEach((vp) => {

                  // Check if the value path is "notifications.mob" (potentially pleonastic)
                  if (vp.path === 'notifications.mob') {

                    // Check if the state is "emergency" and no other mob is active
                    if (!mobNotification && "state" in vp.value && vp.value.state === "emergency") {

                      // Save the mob notification
                      mobNotification = vp.value

                      let resourceId = uuidv4();

                      let timeStamp = new Date()



                      let body = {
                        "name": "POB_" + timeStamp.toISOString(),
                        "description": "Person Over Board",
                        "feature": {
                          "type": "Feature",
                          "geometry": {
                            "type": "Point",
                            "coordinates": [
                              vp.value.data.position.longitude,
                              vp.value.data.position.latitude
                            ]
                          },
                          "properties": {
                            "timestamp": timeStamp.toISOString()
                          },
                          "id": resourceId
                        },
                        "type": "POB"
                      }

                      app.resourcesApi.setResource('waypoints', resourceId, body).then(() => {

                        app.getCourse().then((course) => {

                          nextPoint = course.nextPoint

                          app.setDestination({
                            href: '/resources/waypoints/' + resourceId
                          })
                        })

                      })



                      // Check if is active a mob and the new state is "normal"
                    } else if (mobNotification && "state" in vp.value && vp.value.state === "normal") {

                      if (nextPoint) {
                        app.setDestination(nextPoint);
                      } else {
                        app.clearDestination()
                      }


                      // Nullize the mob
                      mobNotification = null

                    }
                  }
                })
              }
            })
          }
        }
        )
  }

  /* Register the REST API */
  plugin.registerWithRouter = function(router) {



  }

  /*
  Define the stop function (invoked by the framework when the plugin have to be stopped)
  */
  plugin.stop = function () {

    // Unsubscribe each handle
    plugin.unsubscribes.forEach(f => f())

    // Empty the subscribers list
    plugin.unsubscribes = []
  }


  // Return the plugin object
  return plugin

}
