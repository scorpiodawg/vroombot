// Dependencies
const https = require('https');
const request = require('request');
const sprintf = require('sprintf-js').sprintf;

// const vroomApiUrl = "https://invsearch.vroomapi.com/v2/inventory?limit=50&sort=p-a&offset=0&keywords=((minivan))";
// const vroomUrl = "https://www.vroom.com/catalog/all-years/all-makes/minivan/?sort=price";
// const vroomApiUrl = "https://www.vroom.com/catalog/all-years/honda_pilot,kia_sorento,mitsubishi_outlander,hyundai_santa_fe,toyota_highlander,toyota_sienna,mazda_cx-9/?sort=price";

const prefs = {
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
        seats7: !!attr.optionalFeatures.match(/7 Passenger Seating/g)
      });
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
  let url = sprintf(prefs.apiUrl, prefs.models.join(','));
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
            let slackMsg = {
              json: {
                text: sprintf(prefs.slackMsgTemplate, whatsNew.length, prefs.webUrl)
              }
            };
            request.post(slackUrl, slackMsg, (err, resp) => {
              if (resp.statusCode !== 200) {
                console.log("Ok that failed, err=" + err);
                cb(err || ['Failed, status = ' + response.statusCode]);
              } else {
                cb(null, { data: whatsNew || ['Nothing new (unexpected)'] });
              }
            });
          });
        } else {
          cb(null, { data: ['Nothing new (0 diffs)'] });
        }
      });
    });
  });
};