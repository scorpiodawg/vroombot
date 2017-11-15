// Dependencies
var https = require('https');
var request = require('request');
var sprintf = require('sprintf-js').sprintf;

// var vroomApiUrl = "https://invsearch.vroomapi.com/v2/inventory?limit=50&sort=p-a&offset=0&keywords=((minivan))";
// var vroomUrl = "https://www.vroom.com/catalog/all-years/all-makes/minivan/?sort=price";
// var vroomApiUrl = "https://www.vroom.com/catalog/all-years/honda_pilot,kia_sorento,mitsubishi_outlander,hyundai_santa_fe,toyota_highlander,toyota_sienna,mazda_cx-9/?sort=price";

var prefs = {
  apiUrl: "https://invsearch.vroomapi.com/v2/inventory?limit=50&sort=p-a&offset=0&mm=%1$s",
  webUrl: "https://www.vroom.com/catalog/all-years/honda_pilot,kia_sorento,mitsubishi_outlander,hyundai_santa_fe,toyota_highlander,toyota_sienna,mazda_cx-9/?sort=price",
  models: [
    'honda_pilot',
    'kia_sorento',
    'mitsubishi_outlander',
    'hyundai_santa_fe',
    'toyota_highlander',
    'toyota_sienna',
    'mazda_cx-9'
  ],
  slackMsgTemplate: "VROOM: %1$d new hits, <%2$s|check them>"
};

function extractCandidates(data) {
  var ret = [];
  for (var car of data) {
    var attr = car.attributes;
    if (attr.isAvailable === true || attr.soldStatus === 0) {
      ret.push({
        id: car.id,
        make: attr.make,
        model: attr.model,
        year: attr.year,
        miles: attr.miles,
        driveType: attr.driveType,
        price: attr.listingPrice,
        seats7: !!attr.optionalFeatures.match(/7 Passenger Seating/g)
      });
    } else {
      console.log(attr.make, attr.model, "for $", attr.listingPrice, " is already sold");
    }
  }
  return ret;
}

function diff(oldCars, newCars) {
  var d = [];
  if (oldCars.length === 0) return newCars;
  var comparator = (v) => { return v.id === n.id; };
  for (var n of newCars) {
    var found = oldCars.filter(comparator);
    if (found.length === 0) {
      d.push(n); // new guy
    }
  }
  return d;
}

module.exports = function (ctx, cb) {
  var url = sprintf(prefs.apiUrl, prefs.models.join(','));
  console.log("GETting", url)
  https.get(url, (res) => {
    console.log('statusCode:', res.statusCode);
    console.log('headers:', res.headers);
    var responseJson = "";
    res.on('data', (chunk) => responseJson += chunk);
    res.on('end', () => {
      var parsedData = '';
      try {
        parsedData = JSON.parse(responseJson);
        console.log('JSON parsed ok');
      } catch (e) {
        console.log(e.message);
        return cb(new Error('JSON parse failed'));
      }

      // Parse out the candidates
      var candidates = extractCandidates(parsedData.data);

      // Get previous data if any
      var oldData = [];
      ctx.storage.get((error, data) => {
        if (!error && data) { // data may be null if first time?
          console.log("Got old data, " + data.length + " items");
          oldData = data;
        }
        var whatsNew = diff(oldData, candidates);
        var clear = 'c' in ctx.query && ctx.query['c'] == '1';
        if (clear) {
          console.log("Clear requested, clearing storage");
        }
        if (whatsNew.length > 0 || clear) {
          // update data...
          ctx.storage.set(candidates, function (error) {
            if (error) return cb(error);
            // ...and send notification
            slackUrl = ctx.secrets.SLACK_WEBHOOK;
            var slackMsg = {
              json: {
                text: sprintf(prefs.slackMsgTemplate, whatsNew.length, prefs.webUrl)
              }
            };
            var slackMessages = whatsNew.map(function (car) {
              console.log("Adding slack message for ", car.make, car.model);
              return {
                car: car,
                slack: {
                  json: {
                    text: sprintf("Found %1$s %2$s @%3$s %4$s <%5$s|See it>", car.make, car.model, car.price, car.driveType.match(/awd/i) ? "(AWD)" : "", car.links.self)
                  }
                }
              };
            });
            // request.post(slackUrl, slackMsg, (err, resp) => {
            //   if (resp.statusCode !== 200) {
            //     console.log("Ok that failed, err=" + err);
            //     cb(err || ['Failed, status = ' + response.statusCode]);
            //   } else {
            //     cb(null, { data: whatsNew || ['Nothing new (unexpected)'] });
            //   }
            // });

            slackMessages.forEach(function (o) {
              console.log("Posting Slack ping for ", o.car.make, o.car.model);
              request.post(slackUrl, o.slackMsg, (err, resp) => {
                if (resp.statusCode !== 200) {
                  console.log("Ok that failed, err=" + err);
                  cb(err || ['Failed, status = ' + response.statusCode]);
                } else {
                  cb(null, { data: [o.car] || ['Unexpected error'] });
                }
              });
            });
          });
        } else {
          cb(null, { data: ['Nothing new (0 diffs)'] });
        }
      });
    });
  });
};