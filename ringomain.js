/*var {Application} = require("stick");

export("app", "init");
var app = Application();
*/
var settings = require('./settings');
require.paths.push(settings.GAMEJS_DIRECTORY);

var log = require('ringo/logging').getLogger(module.id);

var combatserver=require('./combatserver');
/*
app.configure("notfound", "error", "static", "params", "mount");
app.static(module.resolve("public"));
app.mount("/", require("./actions"));
*/

var server;
var cserver;
var start = function() {

   // see https://gist.github.com/555596
   var context = server.getDefaultContext();
   cserver=new combatserver.CombatServer('ringo');
  // print ('starting it', context.addWebSocket);
   context.addWebSocket("/combatserver/", function (socket) {
      log.info('connection established');

      socket.onopen=function(){
         log.info('new connection ', socket);
      };

      socket.onmessage = function(m) {
         var retv=cserver.handle(m, socket);
      };

      socket.onclose = function() {
         log.info('closed');
         if(this.player){
            this.player.disconnect();
            cserver.log('CLOSE: '+this.player.uid);
         }
      };
   });
   return;
};

// Script run from command line
if (require.main === module) {
   server = require("ringo/httpserver").main(module.id);
   start();
}
