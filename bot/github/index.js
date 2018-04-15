var GitHub = require('github-api');
var request = require('request');
var q = require('q');

function Repofunding(options){
  options = options || {};
  // Global settings!
  this.g_options = Object.assign({
    notifCheckTimeout: 5000,
    token: process.env.GITHUB_REPOFUNDING_TOKEN,
    likeRreaction: "heart"
  }, options);
  // Connect
  this.gh = new GitHub({
    token: this.g_options.token
  });
  // Repofunding user
  this.me = Object.assign(this.gh.getUser(),
    {
      g_options: this.g_options,
      markNotifications: function(cb){
        cb = cb || function(){};
        this._request('PUT', this.__getScopedUrl('notifications'), {}, cb);
      },
      reactToComment: function(user, repo, commentId, reaction){
        var options = {
          method: "POST",
          json: true,
          body: {content: reaction},
          headers:{
            Authorization: "token " + this.g_options.token,
            Accept:"application/vnd.github.squirrel-girl-preview+json",
            "User-Agent": "Mozilla/5.0 (iPad; U; CPU OS 3_2_1 like Mac OS X; en-us) AppleWebKit/531.21.10 (KHTML, like Gecko) Mobile/7B405"
          },
          url: "https://api.github.com/repos/"+user+"/"+repo+"/issues/comments/"+commentId+"/reactions"
        };
        request(options, (err, httpResponse, body) => err && console.error(err));
      },
      listIssueCommentReactions: function(user, repo, comments){
        var options = {
          method: "GET",
          json: true,
          headers:{
            Authorization: "token " + this.g_options.token,
            Accept:"application/vnd.github.squirrel-girl-preview+json",
            "User-Agent": "Mozilla/5.0 (iPad; U; CPU OS 3_2_1 like Mac OS X; en-us) AppleWebKit/531.21.10 (KHTML, like Gecko) Mobile/7B405"
          },
          url: "https://api.github.com/repos/"+user+"/"+repo+"/issues/comments/%COMMENT_Id%/reactions"
        };
        return q.all(comments.map(c => {
          var d = q.defer();
          var ops = Object.assign({}, options);
          ops.url = ops.url.replace("%COMMENT_Id%", c.id);
          request(ops, (err, httpResponse, body) => {
            err && console.error(err);
            c.reactions = body || [];
            d.resolve(c);
          });
          return d.promise;
        }))
        .then(commentsWithReactions => {
          return commentsWithReactions;
        });
      }
  });
}

Repofunding.prototype.log = function(){
  this.g_options.verbose && console.log(arguments);
}

Repofunding.prototype.markNotifications = function(){
  this.log("Reseting notificatins");
  this.me.markNotifications();
}

Repofunding.prototype.processNotifications = function(notifications){
  this.log(notifications.length + " notifications found")
  notifications.map(n => this.processNotification(n));
  this.markNotifications();
}
// Listen to notifications
// TODO: Move to webhooks :(
Repofunding.prototype.checkNotifications = function(){
  var oThis = this;
  this.me.listNotifications(function(err, notifications) {
    err && console.error(err);
    notifications.length && oThis.processNotifications(notifications);
  })
};

Repofunding.prototype.reactToIssueComment = function(user, repo, issueId, comment){
  var myreactions = comment.reactions
    .filter(r => r.user.login === "repofunding" && r.content !== this.g_options.likeRreaction);
    !myreactions.length && this.me.reactToComment(user, repo, comment.id, this.g_options.likeRreaction);
}

Repofunding.prototype.commentIssue = function(user, repo, id, comment){
  this.log("Commenting to issue " + id + " with " + comment.substring(0, 10));
  this.gh.getIssues(user, repo)
    .createIssueComment(id, comment)
    .catch(console.error);
}

Repofunding.prototype.findComments = function(user, repo, issueId, fid){
  var def = q.defer();
  this.gh.getIssues(user, repo)
    .listIssueComments(issueId, (err, comments) => {
      comments.map(c => c.isFromRepofunding = c.user.login === "repofunding");
      return err ? def.reject(err): def.resolve(comments);
    });
  return def.promise
    .then(comments => fid ? comments.filter(fid): comments)
    .then(comments => this.me.listIssueCommentReactions(user, repo, comments));
}

Repofunding.prototype.digestComment = function(comment){
  var tags = /[\#]{2,} tags\:(.*)$/.exec(comment.body);
  comment.keywords = tags && comment.user.login === "repofunding" ?
      tags[1].split(",").map(t => t.replace(/\_/mg, "").trim()):[];
  return comment;
}

Repofunding.prototype.issueDiggestComments = function(user, repo, issue){
  return this.findComments(user, repo, issue.number)
          // Issue itself is not consider a comment :S
          .then(comments => [issue].concat(comments))
          .then(comments => issue.comments = comments.map(c => this.digestComment(c)))
          .then(() => issue);
}

Repofunding.prototype.issueMetadata = function(user, repo, issueId){
  var fkw = (comments, kw) => comments.reverse().filter(c => c.keywords.indexOf(kw) !== -1);
  var def = q.defer();
  this.gh.getIssues(user, repo)
    .getIssue(issueId, (err, issue) => {
      return err ? def.reject(err): def.resolve(issue);
  });
  return def.promise
        .then(issue => this.issueDiggestComments(user, repo, issue))
        .then(issue => {
          return Object.assign(issue, {meta: {
            help: fkw(issue.comments, "help")[0],
            crowdfunding: fkw(issue.comments, "help")[0],
            fixed: fkw(issue.comments, "fixed")[0],
            closed: fkw(issue.comments, "clossed")[0],
            supporting: fkw(issue.comments, "support"),
            repofundingComments: issue.comments.filter(c => c.user.login === "repofunding")
          }});
        })
        .catch(console.error);
}

Repofunding.prototype.deleteIssueComments = function(user, repo, id, filter){
  this.log("Deleting comments for issue " + id);
  var repoIssues = this.gh.getIssues(user, repo);
  repoIssues.listIssueComments(id)
    .then(js => js.data)
    .then(comments => comments.filter(filter))
    .then(comments => comments.map(c => repoIssues.deleteIssueComment(c.id)));
}

Repofunding.prototype.processNotification = function(notification){
  if(notification.reason === "mention" && notification.subject.type === "Issue"){
    this.processMention(notification);
  }
}

Repofunding.prototype.handleMessage = function(user, repo, issue, commentId){
  var issueId = issue.number;
  var comment = issue.comments.filter(c => c.id === commentId)[0];
  var lmsg = comment.body.toLowerCase();
  if(lmsg.indexOf("delete your comments") !== -1 &&
      issue.meta.repofundingComments.length){
    this.deleteIssueComments(user, repo, issueId,
        c => c.user.login === "repofunding");
  }else if(!comment.isFromRepofunding &&
    lmsg.indexOf("@repofunding support") !== -1){
    if(!issue.meta.supporting.length){
      this.supportOrSuggestSupporting(user, repo, issue, comment);
    }
  }
  this.reactToIssueComment(user, repo, issueId, comment);
};

Repofunding.prototype.applyTemplateValues = function(body, data){
  return body.replace(/%([^%]*)%/mg, function(text, match){
    try{
      return eval("data." + match);
    }catch(e){
      return  "";
    }
  });
}

Repofunding.prototype.processTemplate = function(url, data){
  var def = q.defer();
  request.get(url, (err, httpResponse, body) => err ? def.reject(err): def.resolve(body));
  return def.promise
        .then(body => this.applyTemplateValues(body, data));
}

Repofunding.prototype.getPaypalMe = function(user, repo){
  return q.all([user,  user + "_" + repo].map(t => {
      var def = q.defer();
      request.get("https://www.paypal.com/paypalme/api/slug/available/" + t,
                (err, httpResponse, body) => def.resolve(Object.assign(body, {name:t})));
      return def.promise;
    }))
    .then(attempts => attempts.filter(b => b.isAvailable)[0]);
}

Repofunding.prototype.supportOrSuggestSupporting = function(user, repo, issue, comment){
  var isOwner = comment.author_association === "OWNER";
  var isRefOrHelp = /@repofunding\s+support\s+(.*)/i.exec(comment.body);
  if(isOwner && !isRefOrHelp && issue.meta.crowdfunding)
    return;
  var tpl = isOwner ?
                !isRefOrHelp ? "how_to_support.md": "new_issue.md":
                "issue_user_references_repofunding.md";
      var data  = {
          user: user,
          repo: repo,
          issue:issue,
          comment: comment,
          paypalme_id: isRefOrHelp ? isRefOrHelp[1]: null
      };
    this.processTemplate("https://raw.githubusercontent.com/gbrian/repofunding/master/templates/" + tpl, data)
      .then(commentBody => this.commentIssue(user, repo, issue.number, commentBody));
}

Repofunding.prototype.processMention = function(notification){
  //console.log(notification);
  // https://api.github.com/repos/user/repo/issues/4
  var info = notification.subject.url.split("/repos/")[1].split("/");
  var user = info[0];
  var repo = info[1];
  var issueId = parseInt(info[3]);
  var commentId = /.*\/([0-9]+)$/.exec(notification.subject.latest_comment_url)[1];
  commentId = parseInt(commentId);
  this.issueMetadata(user, repo, issueId)
        .then(issue => this.handleMessage(user, repo, issue, commentId));
}

Repofunding.prototype.exit = function(){
  clearInterval(this.g_options.notifInterval);
  process.exit(0);
}
Repofunding.prototype.waitKey = function(){
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', () => exit());
}
Repofunding.prototype.run = function(){
  this.log("Running repofunding")
  var oThis = this;
  oThis.checkNotifications();
  this.g_options.notifInterval = setInterval(() => oThis.checkNotifications(), this.g_options.notifCheckTimeout);
  //this.waitKey();
}
new Repofunding({verbose:true}).run();
