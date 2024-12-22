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


// The geographic library
const geolib = require('geolib')

// Define the subscription period
const subscriptionPeriod = 1000

/*
 Define the plugin
 app - passed by the framework, is the reference to the application
*/
module.exports = function (app) {

  // Define the on stop vector
  let onStop = []

  // Track to the mob
  let track = []

  // The MOB notification object
  let mobNotification = null


  // Define the plugin object and the list of the Signal K update the plugin subscribes to
  let plugin = {

    // The plugin unique id
    id: 'mob-signalk-plugin',

    // The plugin human-readable name
    name: 'SignalK MOB',

    // The plugin description
    description: 'Men Over Board Signal K server plugin',

    // Subscribes
    unsubscribes: []
  }


  // Signal K self identifier
  let selfId = app.selfId

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
    title: "MOB",
    description: "Manage MOB data.",
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

                      // Start watching the vessel position
                      startWatchingPosition();

                      // Check if is active a mob and the new state is "normal"
                    } else if (mobNotification && "state" in vp.value && vp.value.state === "normal") {

                      // Stop watching the vessel position
                      stopWatchingPosition();

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

    /*
    stopWatchingPosition
    Stop watching vessel position
     */
    function stopWatchingPosition() {

      // Unsubscribe all listeners
      onStop.forEach((f) => f())

      // Clean the listeners' list
      onStop = []

      // Clear the track
      track = []

      // Set update the document with null
      app.handleMessage(plugin.id, {
        updates: [
          {
            values: [
              {
                path: 'navigation.mob.position',
                value: null
              },
              {
                path: 'navigation.mob.time',
                value: null
              },
              {
                path: 'navigation.mob.elapsed',
                value: null
              },
              {
                path: 'navigation.mob.distance',
                value: null
              },
              {
                path: 'navigation.mob.bearingTrue',
                value: null
              }
            ]
          }
        ]
      })
    }

    /*
    startWatchingPosition
    Start watching vessel position
     */
    function startWatchingPosition() {

      // If there are already listeners, just return (pleonastic)
      if (onStop.length > 0) return

      // Initialize the document with the mob position and time
      app.handleMessage(plugin.id, {
        updates: [
          {
            values: [
              {
                path: 'navigation.mob.position',
                value: mobNotification.data.position
              },
              {
                path: 'navigation.mob.time',
                value: Date.now()
              }
            ]
          }
        ]
      })

      // Clean the track
      track = []

      // Subscrube for navigation.position
      app.subscriptionmanager.subscribe(
          {
            context: 'vessels.self',
            subscribe: [
              {
                path: 'navigation.position',
                period: subscriptionPeriod
              }
            ]
          },

          // The listeners data structure
          onStop,

          // Execute in case of errors
          (err) => {

            // Set the error
            app.error(err)

            // Set the provider error
            app.setProviderError(err)
          },

          // Execute when a delta is available
          (delta) => {

            // The vessel position
            let vesselPosition

            // Check if the updates array is available
            if (delta.updates) {

              // For each update in the updates array...
              delta.updates.forEach((update) => {

                // Check if the values array is available
                if (update.values) {

                  // For each value in the values array...
                  update.values.forEach((vp) => {

                    // Check if the value path is 'navigation.position' (potentially pleonastic)
                    if (vp.path === 'navigation.position') {

                      // Save the vessel position
                      vesselPosition = vp.value

                      // Create the mob delta
                      let mobDelta = getMOBDelta(app,vesselPosition);

                      // Update the document
                      app.handleMessage(plugin.id, mobDelta)

                      // Track the positon. Only record the position every 30s.
                      if (
                          track.length === 0 ||
                          track[track.length - 1].time < Date.now() - 30 * 1000
                      ) {

                        // Add the position to the track array
                        track.push({
                          position: vesselPosition,
                          time: Date.now()
                        })

                        // Check if the track length reach the maximum capacity
                        if (track.length > 12 * 120) {

                          // Recycle the track
                          track.shift()
                        }
                      }
                    }
                  })
                }
              })
            }
          }
      )
    }
  }

  /* Register the REST API */
  plugin.registerWithRouter = function(router) {

    // Create the getDelta API
    router.get('/getTrack', (req, res) => {

      // Return the track
      res.json(track)
    })

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

  /*
  radsToDeg
  Convert the radiant in degrees
  */
  function radsToDeg(radians) {
    return (radians * 180) / Math.PI
  }

  /*
  degsToRad
  Convert the degrees in radiant
  */
  function degsToRad(degrees) {
    return degrees * (Math.PI / 180.0)
  }

  /*
  calc_distance
  Compute the distance between two geographical points using the geolib library
  */
  function calc_distance(lat1, lon1, lat2, lon2) {
    return geolib.getDistance(
        { latitude: lat1, longitude: lon1 },
        { latitude: lat2, longitude: lon2 },
        0.1
    )
  }

  /*
  calc_position_from
  Compute the a position giving a starting point, heading and distance using the geolib library
  */
  function calc_position_from(app, position, heading, distance) {
    return geolib.computeDestinationPoint(position, distance, radsToDeg(heading))
  }

  /*
  computeBowLocation
  Compute the bow position considering the GPS offset
  */
  function computeBowLocation(position, heading) {

    // Check if the heading is defined
    if (typeof heading != 'undefined') {

      // Get the distance from the bow of the gps sensor
      let gps_dist = app.getSelfPath('sensors.gps.fromBow.value')

      // Check if this distance is defined
      if (typeof gps_dist != 'undefined') {

        // Compute the new positionm
        position = calc_position_from(app, position, heading, gps_dist)

      }
    }

    // Return the result
    return position
  }

  /*
  getMOBDelta
  Prepare the mob delta giving the vessel position
  */
  function getMOBDelta(app, position) {

    // Set the values array
    let values = []

    // Get the mob position
    let mobPosition = app.getSelfPath('navigation.mob.position.value')

    // Check if vessel position and mob positions are available
    if (position && mobPosition) {

      // Get the mob time
      let mobTime = app.getSelfPath('navigation.mob.time.value')

      // Calc the bow position
      let bowPosition = computeBowLocation( position, app.getSelfPath('navigation.headingTrue.value'))

      // Calculate the bearing to the mob
      let bearing = degsToRad(geolib.getRhumbLineBearing(bowPosition, mobPosition))

      // Calculate the distance to the mob
      let distance = calc_distance(
          bowPosition.latitude, bowPosition.longitude,
          mobPosition.latitude, mobPosition.longitude )

      // Add the elapsed time to the values
      values.push({
        path: 'navigation.mob.elapsed',
        value: (Date.now() - mobTime) / 1000
      })

      // Add the distance to the values
      values.push({
        path: 'navigation.mob.distance',
        value: distance
      })

      // Add the bearing to the values
      values.push({
        path: 'navigation.mob.bearingTrue',
        value: bearing
      })
    } else {
      values = [
        {
          path: 'navigation.mob.position',
          value: null
        },
        {
          path: 'navigation.mob.time',
          value: null
        },
        {
          path: 'navigation.mob.elapsed',
          value: null
        },
        {
          path: 'navigation.mob.distance',
          value: null
        },
        {
          path: 'navigation.mob.bearingTrue',
          value: null
        }
      ]
    }

    // Return the delta
    return { updates: [ { values: values } ] }
  }

  // Return the plugin object
  return plugin

}