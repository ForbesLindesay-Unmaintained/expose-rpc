A module to enable very simple connectionless RPC from client to server.  It is a simple request response model, so doesn't require the complex connection logic that's used in other RPC systems.  expose-rpc uses JSONRPC behind the scenes as a message protocol, this is widely supported and therefore very interopreable.  Another key advantage over other RPC systems is that expose-rpc has full access to the request object, so can do authentication and access session variables easily.

# Installation

    npm install expose-rpc

You must also install and enable express-expose

    npm install express-expose

Then you can require both packages and they will monkeypatch express.  This must be done in the correct order:

    require('express-expose');
    require('expose-rpc');

Use at will

# Exposing and calling application level functions

server.js

```javascript

app.exposeRPC(function(rpc){

    rpc.server = {};
    rpc.server.log = function(msg, cb){
        console.log(msg);
        cb();
    };

    rpc.server.echo = function(msg, cb){
        cb(null, msg);
    };

});


app.expose(function(){

    //code run on client
    server.log("hello world");
    server.echo("echo echo", function(error, msg){console.log(msg);});

});


```

Anything you attach to the rpc object is available to the client side code, providing you are using express-expose correctly.

The first argument of the callback is special and must always be null unless there is an error.  If it is not null, all subsequent parameters will be ignored, and not sent to the client.

Callback functions can have as many parameters as you like and the callback must always be the last parameter given to the function.

# Request level exposure

You can't do exposure on a per request basis as such, but you can do it on a per path basis.  This could include wildcards.

```javascript

app.exposeRPC('/user/:uid', function(rpc){
    rpc.getUserData = function(cb){
        //get userid from request object
        var id = this.params.uid;
        databse.get(id, cb);
    };
});

```

# Function Chaining

You can chain functions, which is great for validation/authorisation.

```javascript
app.exposeRPC('/user/:uid', function(rpc){
    rpc.updateUserData = function(newValue, cb){
        if(this.user)cb();
        else cb("the user must be logged in to update data");
    };
});
app.exposeRPC('/user/:uid', function(rpc){
    rpc.updateUserData = function(newValue, cb){
        //get userid from request object
        var id = this.params.uid;
        databse.set(id, newValue, cb);
    };
});
```

Note that we always call the callback, even if there's an error.  If you don't do this, the request may wait forever.  calling back with absolutely 0 arguments means that the later functions in the chain should be tried as well.  If you want to pass something on to the next function in the chain, simply add it to "this" which represents the request object.  Calling the callback with any arguments, errors or otherwise, ends the request there.  This lets you use it to either stop early with sucessful hits of caches, or unsuccessful requests because of validation or authorisation problems.  If it's the last function in the chain, calling the callback with no arguments is treated as success.