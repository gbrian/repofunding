
var Gitter = require('node-gitter');
var token = process.env.GITTER_REPOFUNDING_TOKEN;
var gitter = new Gitter(token);
var roomId = 'repofunding/Lobby';
var botref = "@repofunding";

function help(){
  return "https://github.com/gbrian/repofunding";
}

function isBotMessage(message){
  return message.indexOf(botref) !== -1 ?
          message.replace(botref, "").trim(): null;
}
function processMessage(message){
  message = isBotMessage(message);
  if(!message) return;
  if(message == "help")
    return help();
}


gitter.currentUser().then(function(user) {
  console.log('You are logged in as:', user.username);
});

gitter.rooms.join(roomId).then(function(room) {
  console.log("Joined", roomId)
  var events = room.streaming().chatMessages();

  // The 'snapshot' event is emitted once, with the last messages in the room
  events.on('snapshot', function(snapshot) {
    console.log(snapshot.length + ' messages in the snapshot');
  });

  // The 'chatMessages' event is emitted on each new message
  events.on('chatMessages', function(message) {
    console.log('A message was ' + message.operation);
    console.log('Text: ', message.model.text);
    msg = message.model.text;
    if(msg){
      res = processMessage(msg.toLowerCase());
      if(res)
        room.send(res);
    }
  });
}).fail(function(err) {
  console.log('Not possible to join the room: ', err);
});

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', process.exit.bind(process, 0));