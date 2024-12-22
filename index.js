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

const path = require('path')
const fs = require('fs')
const geolib = require('geolib')

const subscribrPeriod = 1000

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
    description: 'Plugin that manage MOB data',

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
        {
          context: 'vessels.self',
          subscribe: [
            {
              path: 'notifications.mob',
              period: subscribrPeriod
            }]
        },
        plugin.unsubscribes,
        (err) => {
          app.error(err)
          app.setProviderError(err)
        },
        (delta) => {


          if (delta.updates) {
            delta.updates.forEach((update) => {
              if (update.values) {
                update.values.forEach((vp) => {
                  if (vp.path === 'notifications.mob') {

                    if (!mobNotification && "state" in vp.value && vp.value.state === "emergency") {

                      mobNotification = vp.value

                      startWatchingPosition();

                    } else if ("state" in vp.value && vp.value.state === "normal") {

                      stopWatchingPosition();

                      mobNotification = null

                    }
                  }
                })
              }
            })
          }
        })

    function stopWatchingPosition() {
      onStop.forEach((f) => f())
      onStop = []
      track = []

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

    function startWatchingPosition() {
      if (onStop.length > 0) return



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

      track = []

      app.subscriptionmanager.subscribe(
          {
            context: 'vessels.self',
            subscribe: [
              {
                path: 'navigation.position',
                period: subscribrPeriod
              },
              {
                path: 'navigation.headingTrue',
                period: subscribrPeriod
              }
            ]
          },
          onStop,
          (err) => {
            app.error(err)
            app.setProviderError(err)
          },
          (delta) => {
            let vesselPosition

            if (delta.updates) {
              delta.updates.forEach((update) => {
                if (update.values) {
                  update.values.forEach((vp) => {
                    if (vp.path === 'navigation.position') {
                      vesselPosition = vp.value
                      // Track the positon. Only record the position every 30s.
                      if (
                          track.length === 0 ||
                          track[track.length - 1].time < Date.now() - 30 * 1000
                      ) {
                        track.push({
                          position: vesselPosition,
                          time: Date.now()
                        })
                        if (track.length > 12 * 60) {
                          // Keep only the last 12 hours of track to avoid memory issues
                          track.shift()
                        }
                      }
                    }
                  })
                }
              })
            }

            if (mobNotification) {

              let mobDelta = getMOBDelta(app,vesselPosition);

              app.handleMessage(plugin.id, mobDelta)
            }
          }
      )
    }


  }

  /* Register the REST API */
  plugin.registerWithRouter = function(router) {

    router.get('/getTrack', (req, res) => {
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

  function radsToDeg(radians) {
    return (radians * 180) / Math.PI
  }

  function degsToRad(degrees) {
    return degrees * (Math.PI / 180.0)
  }

  function calc_distance(lat1, lon1, lat2, lon2) {
    return geolib.getDistance(
        { latitude: lat1, longitude: lon1 },
        { latitude: lat2, longitude: lon2 },
        0.1
    )
  }

  function calc_position_from(app, position, heading, distance) {
    return geolib.computeDestinationPoint(position, distance, radsToDeg(heading))
  }

  function computeBowLocation(position, heading) {
    if (typeof heading != 'undefined') {
      let gps_dist = app.getSelfPath('sensors.gps.fromBow.value')
      app.debug('gps_dist: ' + gps_dist)
      if (typeof gps_dist != 'undefined') {
        position = calc_position_from(app, position, heading, gps_dist)
        app.debug('adjusted position by ' + gps_dist)
      }
    }
    return position
  }

  function getMOBDelta(
      app,
      position
  ) {
      let values = []

      let mobPosition = app.getSelfPath('navigation.mob.position.value')

    
      if (position && mobPosition) {


        let mobTime = app.getSelfPath('navigation.mob.time.value')

        let bowPosition = computeBowLocation(
            position,
            app.getSelfPath('navigation.headingTrue.value')
        )

        let bearing = degsToRad(geolib.getRhumbLineBearing(bowPosition, mobPosition))

        let distance = calc_distance(
            bowPosition.latitude,
            bowPosition.longitude,
            mobPosition.latitude,
            mobPosition.longitude
        )



        values.push({
          path: 'navigation.mob.elapsed',
          value: (Date.now() - mobTime) / 1000
        })

        values.push({
          path: 'navigation.mob.distance',
          value: distance
        })

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

    //app.debug("anchor delta: " + util.inspect(delta, {showHidden: false, depth: 6}))
      return {
        updates: [
          {
            values: values
          }
        ]
      }
  }

  // Return the plugin object
  return plugin

}
