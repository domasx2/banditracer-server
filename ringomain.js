var {Application} = require("stick");
var settings = require('banditracer-client').settings;
var log = require('ringo/logging').getLogger(module.id);

export("app");
var app = Application();
app.configure("mount");
app.mount("/", require("banditracer-client/webapp"));

var combatserver=require('./combatserver');

var server;
var cserver;
var start = function() {

   var context = server.getDefaultContext();
   cserver=new combatserver.CombatServer('ringo');
   context.addWebSocket("/combatserver/", function (socket) {
      log.info('connection established');

      socket.onmessage = function(m) {
         var retv=cserver.handle(m, socket);
      };

      socket.onclose = function() {
         log.info('closed', socket);
         if(this.player)this.player.disconnect();
      };
   });
   return;
};

var startUp = exports.startUp = function() {
   server = require("ringo/httpserver").main(module.id);
   start();
};

// Script run from command line
if (require.main === module) {
    startUp();
}
