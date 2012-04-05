var express = require('express')
  , traverse = require("traverse")
  , HTTPSServer = express.HTTPSServer
  , HTTPServer = express.HTTPServer;


function exposeHelper(app){
	if(!app._exposedRPCHelper){
		app._exposedRPCHelper = true;
		//////////////////////////////
    	//!!Depends on private API!!//
    	//////////////////////////////
    	app._exposedRPCHelperWithRequire = app._require;//Check if we have exposed require;

        app.expose({
        	register:function registerRPC(methods, global, path){
        		function registerSingle(method, global){
            		var current = global;
            		for(var i = 0; i<method.length-1; i++){
            			current[method[i]] = current[method[i]] || {};
            			current = current[method[i]];
            		}
            		current[method[method.length-1]] = function(){
            			var args = [].slice.call(arguments),
            				callback;
            			if(typeof args[args.length - 1] === "function"){
            				callback = args.pop();
            			}
            			var request = {jsonrpc:"2.0",method:method.join("."),params:args};
            			if(callback)request.id = 1;
            			$.ajax((path || location.href),{
            				type:"POST",
            				data: JSON.stringify(request),
                			contentType: 'application/json',
                			success: function(res){
                				if(callback){
                    				if (res.error) callback(res.error);
                    				else{
                    					var args = res.result;
                    					args.unshift(null);
                    					callback.apply({}, args);
                    				}
                				}
                			},error:function(jqXHR, textStatus){
                				if(callback) callback(textStatus);
                				else throw textStatus;
                			}
            			});
                	};
            	}
            	for(var i = 0; i<methods.length; i++){
            		registerSingle(methods[i], global);
            	}
            }
        }, "rpc");
    }
    return app._exposedRPCHelperWithRequire;
}


function toDefinitions(methods){
	return traverse(methods).reduce(function (acc, value){
		var path = this.path;
		if(path.length !== 0 && typeof value === "function"){
			acc[path.join(".")] = {client:path, server:value};
		}
		return acc;
	}, {});
}


function exposeClient(exposeOn, methods, useRequire, path){
	if(methods.length > 0) exposeOn.expose( (useRequire?'require("rpc")':'window.rpc') + '.register(' + JSON.stringify(methods) + ',this' + (path?', "' + path + '"':'')+');');
}

function decodeRequest(req, next){
	if(req.decodedRPC && req.decodedRPC === "notRPC"){
		next();
		return null;
	}else if(req.decodedRPC){
		return req.decodedRPC;
	}
	function ignore(msg){
		if(msg)console.log("request not treated as rpc because " + msg);
		req.decodedRPC = "notRPC";
		return null;
	}
	function error(msg){
		next(msg);
		req.decodedRPC = "notRPC";
		return null;
	}
	if(!req.is('*/json')){
		return ignore("not of type json");
	}
	if(!req.body){
		return error("You don't appear to have the body parser enabled, expose-RPC can't work without that.");
	}
	var request = req.body;
	if(!request.jsonrpc || request.jsonrpc !== "2.0"){
		return ignore("property jsonrpc was not present or did not equal '2.0'");
	}
	if(!request.method || typeof request.method !== "string"){
		return error("The method property was not present or was not of type string on expose-rpc request");
	}
	if(request.method.indexOf("rpc.") === 0){
		console.log("RPC request ignored because method name started with reserved string 'rpc.'");
		req.decodedRPC = "notRPC";
		return null;
	}
	var method = request.method
	  , params = request.params || []
	  , id = request.id;
	var result = {method:method, params:params, id:id};
	req.decodedRPC = result;
	return result;
}

var handled = {};
var allRPCPaths = {};

HTTPServer.prototype.exposeRPC =
HTTPSServer.prototype.exposeRPC = function(pathOrMethods, Methods){

	/////////////////
	//Fix Arguments//
	/////////////////
	var path, methods;
	if(arguments.length === 0){
		throw "Must provide exposeRPC with some methods to expose";
	} else if (arguments.length === 1){
		methods = pathOrMethods;
	} else if (arguments.length === 2){
		path = pathOrMethods;
		methods = Methods;
	}
	if(path && typeof path !== "string"){
		throw "path for exposeRPC must be a string";
	}
	if(typeof methods === "function"){
		(function(){
    		var rpc = {};
    		methods = methods(rpc) || rpc;
		}());
	}
	if(typeof methods !== "object"){
		throw "methods for exposeRPC must be a function or object";
	}
	path = path || '/exposeRPC';
	methods = toDefinitions(methods);
	///////////////
	//Method Body//
	///////////////
	var usedRequire = exposeHelper(this);
	var RPCPath = allRPCPaths[path] || (allRPCPaths[path] = {server:{}, client:[]});
	
	var newClient = [];
	for	(var methodName in methods){
		if(typeof RPCPath.server[methodName] === "undefined"){
			RPCPath.server[methodName] = [];
			RPCPath.client.push(methods[methodName].client);
		}
		newClient.push(methods[methodName].client);
		RPCPath.server[methodName].push(methods[methodName].server);
	}
	
	if(!handled[path]){
		handled[path] = true;
		if(path !='/exposeRPC'){
    		this.get(path, function (req, res, next){
    			//expose using RPCPath.client
    			exposeClient(res, RPCPath.client, usedRequire);
    			next();
    		});
		}
		this.post(path, function(req, res, next){
			//handle using RPCPath.server
			handleRPC(RPCPath.server, req, res, next);
		});
	}
	if(path ==='/exposeRPC'){
		//expose using newClient
		exposeClient(this, newClient, usedRequire, path);
	}
};

function handleRPC(server, req, res, next){
    var request = decodeRequest(req, next);
    if(request){
    	function handleNext(methodList){
        	if(typeof methodList === "undefined"){
        		//attempt to call non-existant method
        		res.json({
    				jsonrpc:"2.o",
    				error:{code:-32601, message: "Method not found" },
    				id:request.id
    			});
        		return;
        	}
        	if(methodList.length === 0){
        		//everything happened fine, callback with [] as the response.
    			res.json({
    				jsonrpc:"2.o",
    				result:[],
    				id:request.id
    			});
        		return;
        	}
        	
        	function callback(err){
            	if(arguments.length === 0){
            		handleNext(methodList.slice(1));
            	}else if(typeof request.id !== "undefined"){
            		if(err){
            			res.json({
            				jsonrpc:"2.o",
            				error:{code:500, message: err },
            				id:request.id
            			});
            		}else{
            			var args = [].slice.call(arguments);
            			args.shift();
            			res.json({
            				jsonrpc:"2.o",
            				result:args,
            				id:request.id
            			});
            		}
            	}
            }
            methodList[0].apply(req, request.params.concat(callback));
        }
        handleNext(server[request.method]);
    }
}
