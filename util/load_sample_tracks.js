'use strict';

/**
 * Module dependencies.
 */

var artistIds = require('./artist-ids')
  , https = require('https')
  , JSONStream = require('JSONStream')
  , requestSize = 200 // The number of songs to retrieve for each artist
  , addProbability = 0.12
  , parser
  , popIds = artistIds.pop
  , rapIds = artistIds.rap
  , rc = require('redis').createClient()
  , rockIds = artistIds.rock
  , rooms = require('../config').rooms
  , score
  , requestElapsed = 0 // Skip counter
  , songId = 0;



const image100 = [
  'http://xn----7sbhkxe3cpe.xn--p1ai/bitrix/images/shaurma.png',
  'http://pochemu.su/wp-content/uploads/2013/07/chto-delat-esli-ya-shaurma.jpg',
  'http://cdn.vkusnoblog.net/sites/default/files/styles/100x100/public/shaurma.jpg?itok=x8eo_NYf'
];

const image60 = [
  'http://i.otzovik.com/objects/m/170000/164460.png',
  'http://user.vse42.ru/files/P_S60x60/Wnone/ui-55d4c4fd5c0b12.04036369.jpeg'
];

const normalSymbol = new RegExp('[a-zA-Zа-яА-ЯёЁ0-9ÀÈÌÒÙàèìòùÁÉÍÓÚÝáéíóúýÂÊÎÔÛâêîôûÃÑÕãñõÄËÏÖÜäëïöüçÇßØøÅåÆæÞþÐð' +
    '()\\-\\+,.:;!?\\[\\]/\\ _]');

/**
 * remove all stars, notes, pictures etc.
 */
var clearString = function (string) {
  //var normalSymbol = new RegExp('[a-zA-ZÀÈÌÒÙàèìòùÁÉÍÓÚÝáéíóúýÂÊÎÔÛâêîôûÃÑÕãñõÄËÏÖÜäëïöüçÇßØøÅåÆæÞþÐð$' +
  //    '\-(),.:;!?\[\] ]');
  var prepared = '';
  for (var i = 0; i < string.length; i++) {
    if (normalSymbol.test(string[i])) {
      prepared = prepared + string[i];
    }
  }
  return prepared.trim();
};

var choose = function (choices) {
  var index = Math.floor(Math.random() * choices.length);
  return choices[index];
};

var debugArtists = new Set();
var debugArtistShorter = function (artist) {
  return artist.trim().substring(0, 10).toLowerCase();
};

var makeParser = function (rooms) {
  parser = JSONStream.parse('response.*.*');

  parser.on('data', function (track) {
    /*for (var key in track) {
      if (track.hasOwnProperty(key)) {
        if (key == 'error') {
          process.stdout.write('ERROR: ' + JSON.stringify(track[key]));
        } else {
          process.stdout.write(key + ',')
        }
      }
    }
    process.stdout.write('\n\n');
    return;*/
    if (typeof(track) == 'number') {
      //first object is int, not a song
      return;
    }
    if (Math.random() < addProbability) {
      return;
    }

    var artist = clearString(track.artist);
    var debugArtist = debugArtistShorter(artist);
    if (!debugArtists.has(debugArtist)) {
      process.stdout.write('parsing ' + debugArtist + '\n');
      debugArtists.add(debugArtist);
    }

    rc.hmset('song:' + songId,
        'artistName', clearString(track.artist),
        'trackName', clearString(track.title),
        'trackViewUrl', track.url,
        'previewUrl', track.url,
        'artworkUrl60', choose(image60),
        'artworkUrl100', choose(image100)
    );

    //var rooms = ['mixed', 'hits', 'pop', 'rap', 'oldies', 'rock']; //todo: why only this?
    rooms.forEach(function (room) {
      var _score = (room === 'mixed') ? songId : score;
      rc.zadd(room, _score, songId);
    });

    score++;
    songId++;
  });

  parser.on('end', function () {
    requestElapsed--;
    if (requestElapsed == 0) {
      rc.quit();
      process.stdout.write('OK\n');
    }
  });

  return parser;
};

var horribleWait = function(millis) {
  var waitTill = new Date(new Date().getTime() + millis);
  while(waitTill > new Date()){}
};

var loadForOneGenre = function (queries, rooms) {
  //example of authorization:
  var code_req = 'https://oauth.vk.com/authorize?' +
      'client_id=5777687&redirect_uri=https://oauth.vk.com/blank.html&scope=audio&response_type=code';
  var code = '';
  var token_req = 'https://oauth.vk.com/access_token?' +
      'client_id=5777687&client_secret=3eonFQJYjuuFyyU5WM1y&redirect_uri=https://oauth.vk.com/blank.html&code=' + code;

  var token = 'ACCESS_TOKEN_HERE';

  score = 0;
  var joinedQuery = queries
      .map(function(str) { return encodeURIComponent(str)})
      .join('|'); // delimiter
  var options = {
    headers: {'content-type': 'application/json'},
    host: 'api.vk.com',
    // Look up multiple artists by their IDs and get `limit` songs for each one
    path: '/method/execute.getAudios?query=' + joinedQuery + '&count='
    + requestSize + '&access_token=' + token,
    timeout: 7000//queries.length * 500
  };

  process.stdout.write('request for query ' + joinedQuery + '\n');
  https.request(options, function (res) {
    process.stdout.write('parsing result for query ' + joinedQuery + '\n');
    res.pipe(makeParser(rooms));
  }).end();
  horribleWait(600);
};

rc.del(rooms, function(err) {
  if (err) {
    throw err;
  }

  process.stdout.write('Loading sample tracks... \n');

  requestElapsed = 3; //pop + rap + rock
  loadForOneGenre(popIds, ['mixed', 'hits', 'pop']);
  loadForOneGenre(rapIds, ['mixed', 'rap']);
  loadForOneGenre(rockIds, ['mixed', 'oldies', 'rock']);
});
