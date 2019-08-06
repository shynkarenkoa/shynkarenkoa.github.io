'use strict';

var PushKa = function( params )
{
    this.config = {
        mode        : 'same-origin',  // 'system-origin', 'partner-origin', 'all-origin'
        debug       : true,
        pid         : 1,
        sourceId    : 1,
        landingId   : null,
        appId       : null,
        afterInit   : function (subs){ log('Success init subscription:'+self.subscriptionStatus); },
        subscribe   : function (subs){ log('Success subscribed: '  +subs.endpoint); },
        unsubscribe : function (subs){ log('Success unsubscribed: '+subs.endpoint); },
        declined    : function ()    { log('Decline subs'); },
        notSupported: function ()    { log('Not supported push subs'); },
        notAllowed  : function ()    { log('Registration failed - permission denied'); },
        marks       : {
            utm_source   : null,
            utm_medium   : null,
            utm_campaign : null,
            utm_term     : null,
            utm_content  : null
        },
        addVars     : {}
    };

    var self        = this;
    var saveStorage = null; //(new IndexDbStorage('push-ka', 'params'));

    extend(this.config, params, {
        worker : {
            version : '3',
            url     : '/service-worker.js?b=5'
        },
        storagePrefix : 'push-ka-'
    });

    this.config.apiBaseUrl = getApiBaseUrl();

    this.subscriptionItem   = null;
    this.pushServiceWorker  = null;
    this.subscriptionStatus = 'undefined';
    this.subscriptionCount  = 0;
    this.browser            = getBrowser(navigator.userAgent);

    this.log           = log;
    this.error         = error;
    this.subscribe     = subscribe;
    this.unsubscribe   = unsubscribe;
    this.getSubsId     = getSubscriptionId;
    this.getSubsStatus = getSubscriptionStatus;

    function getApiBaseUrl()
    {
        if( window.location.host === 'localhost' || window.location.host === '127.0.0.1' )
            return 'http://127.0.0.1/api/';

        if( self.config.mode === 'partner-origin' )
            return 'https://push-'+self.config.pid+'.burningpush.info/api/';

        return 'https://burningpush.info/api/';
    }

    function storage()
    {
        if( saveStorage === null )
            saveStorage = (new IndexDbStorage('push-ka', 'params'));

        return saveStorage;
    }

    function getSubscriptionId()
    {
        if( getSubscriptionStatus === 'subscribed' )
            return storage().get('sid');

        return new Promise(function(resolve){resolve(null)});
    }

    function getBrowser(userAgent)
    {
        if( /firefox/i.test(userAgent) )
            return 'firefox';

        if( /YaBrowser/i.test(userAgent) )
            return 'yandex';

        if( /Opera|OPR\/[0-9.]+/i.test(userAgent) )
            return 'opera';

        if( /Chrome/i.test(userAgent) )
            return 'chrome';

        if( /Safari/i.test(userAgent) )
            return 'safari';

        return false;
    }

    function error(msg)
    {
        //if( isDebugMode() )
        //    alert("Error:"+msg);

        console.error(msg);
    }

    function log(msg)
    {
        if( isDebugMode() )
            console.log(msg);
    }

    function init()
    {
        try{
            if( isSupportPush() === false && (self.config.mode === 'all-origin' || self.config.mode === 'same-origin' ) )
                throw 'Push notification are not supported in this browser; '+navigator.userAgent;

            if( isSupportPromise() === false )
                throw 'Promise not supported in this browser; '+navigator.userAgent;

            if( self.config.mode === 'system-origin' || self.config.mode === 'partner-origin' )
            {
                self.subscriptionStatus = 'unsubscribed';
                return checkSubscription();
            }
            else
                registerWorker(self.config.worker.url);  // here call afterRegisterWorker method
        }
        catch(e) {
            error(e);

            self.config.notSupported();
            return false;
        }

        return true;
    }

    function subscribe()
    {
        navigator.serviceWorker.ready.then(function(serviceWorkerRegistration) {
            serviceWorkerRegistration.pushManager.subscribe({userVisibleOnly: true})
                .then(function(subscription) {

                    self.subscriptionItem   = subscription;
                    self.subscriptionStatus = 'subscribed';
                    self.subscriptionCount++;

                    // Send the subscription subscription.endpoint
                    sendSubscriptionToServer(subscription, 'subscribe');
                })
                .catch(function(e) {
                    if (Notification.permission === 'denied')
                    {
                        log('Error on subscribe to push: The user has blocked notifications');
                        self.subscriptionStatus = 'declined';
                        self.config.declined();
                        return;
                    }

                    // for firefox: user can hold decision (it mean as declined bu you can repeat)
                    if(self.browser === 'firefox' && Notification.permission === 'default' )
                    {
                        self.subscriptionStatus = 'declined';
                        log("Error on subscribe to push: Holding decision for firefox");
                        self.config.declined();
                        return;
                    }

                    self.subscriptionStatus = 'undefined';

                    if(isPushScriptSubdomain() === true && getChromeVersion() >= 74)
                        self.config.notAllowed();

                    error("Error on subscribe to push: "+e);
                });
        }).catch(function(e) {
            error('Error thrown while subscribing ot push messaging: '+e);
        });

        return self.subscriptionStatus === 'subscribed';
    }

    function unsubscribe()
    {
        navigator.serviceWorker.ready.then(function(serviceWorkerRegistration) {
            serviceWorkerRegistration.pushManager.getSubscription().then(
                function(subscription) {
                    // Check we have a subscription to unsubscribe
                    if (!subscription) {
                        // No subscription object, so set the state; allow the user to subscribe to push
                        self.subscriptionStatus = 'unsubscribed';
                        return true;
                    }

                    self.subscriptionItem = subscription;

                    // We have a subcription, so call unsubscribe on it
                    subscription.unsubscribe().then(function() {
                        self.subscriptionStatus = 'unsubscribed';
                        self.subscriptionItem = null;
                        sendSubscriptionToServer(subscription, 'unsubscribe');
                    }).catch(function(e) {
                        self.subscriptionStatus = 'undefined';
                        error("Error on unsubscribe: "+e);
                    });
                }
            ).catch(function(e) {
                error('Error thrown while unsubscribing from push messaging: '+e);
            });
        });

        return self.subscriptionStatus === 'unsubscribed';
    }

    function sendSubscriptionToServer(subs, mode)
    {
        storage().get('uid').then(function(userId){
            storage().get('sid').then(function(subsId){
                storage().get('srv').then(function(srvId){
                    fetch(self.config.apiBaseUrl+'subscription'+(srvId ? '?srv='+srvId : ''), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json; charset=UTF-8'
                        },
                        credentials: "include",
                        body: JSON.stringify({
                            mode     : mode,
                            page     : window.location.href,
                            tz       : getTimeZone(),
                            tzOffset : -(new Date()['getTimezoneOffset']()),
                            id       : subsId,
                            clientId : userId,
                            srvId    : srvId,
                            sourceId : self.config.sourceId,
                            landingId: self.config.landingId,
                            version  : self.config.worker.version,
                            appId    : self.config.appId,
                            marks    : self.config.marks,
                            addVars  : self.config.addVars,
                            subs     : subs
                        })
                    })
                    .then(function(response)
                    {
                        if(response.ok)
                            return response.json();

                        throw new Error('Response was not ok; Status:'+response.status+' '+response.statusText);
                    })
                    .then(function(data)
                    {
                        if(data.type === 'subscribe' && data.id)
                        {
                            storage().set('sid', data.id);
                            storage().set('uid', data.clientId);
                            storage().set('srv', data.srvId);

                            log('Success send subscription to server');
                            self.config.subscribe(subs);
                        }
                        else if(data.type === 'unsubscribe')
                        {
                            storage().del('sid');

                            log('Success send unsubs to server');
                            self.config.unsubscribe(subs);
                        }
                        else
                            log('Undefined type on sent respone');
                    })
                    .catch(function(err){
                        error('Error on send push status to server:'+err+'; uri:'+self.config.apiBaseUrl+'subscription'+'; uid:'+userId+'; sid:'+subsId+'; srv:'+srvId+'; endpoint:'+(subs.endpoint ? subs.endpoint : ''));
                        if(err instanceof TypeError)
                            error(err.name+':'+err.message+'; Line:'+err.fileName+':'+err.lineNumber+':'+err.columnNumber+'; stack:'+err.stack);
                    });
                })
                .catch(function(err){error('Error on get srv to send to server:'+err+'; uid:'+userId+'; sid:'+subsId+'; endpoint:'+(subs.endpoint ? subs.endpoint : ''));});
            })
            .catch(function(err){error('Error on get sid to send to server:'+err+'; uid:'+userId+'; endpoint:'+(subs.endpoint ? subs.endpoint : ''));});
        })
        .catch(function(err){error('Error on get uid to send to server:'+err+'; endpoint:'+(subs.endpoint ? subs.endpoint : ''));});
    }

    function getTimeZone()
    {
        try{
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        }
        catch(e) {
            error(e);
            return null;
        }
    }

    function isPushWorkerRegistered()
    {
        return self.pushServiceWorker !== null;
    }

    function isSupportServiceWorker()
    {
        return ('serviceWorker' in navigator);
    }

    function isSupportPromise()
    {
        return ('Promise' in window);
    }

    function isSupportPush()
    {
        if( isSupportServiceWorker() === false )
        {
            log("Service worker not supported");
            return false;
        }

        if( ('showNotification' in ServiceWorkerRegistration.prototype) === false )
        {
            log("Service worker notification not supported");

            return false;
        }

        return ('PushManager' in window);
    }

    function getSubscriptionStatus()
    {
        return self.subscriptionStatus;
    }

    function extend(target) {
        if(!arguments[1])
            return;

        for(var i=1; i < arguments.length; i++) {
            var source = arguments[i];

            for(var prop in source) {
                if(source.hasOwnProperty(prop)) {
                    target[prop] = source[prop];
                }
            }
        }
    }

    function initSubscription()
    {
        navigator.serviceWorker.ready.then(function(serviceWorkerRegistration) {
            serviceWorkerRegistration.pushManager.getSubscription().then(function(subscription)
            {
                self.subscriptionItem = subscription;
                self.subscriptionStatus = (!subscription) ? 'unsubscribed' : 'subscribed';

                log('On init subs status');
                if(self.config.mode === 'same-origin')
                    return self.config.afterInit(subscription);

                checkSubscription(subscription);
            })
            .catch(function(err) {
                error('Error on getSubscription(); Error:'+err);
            });
        }).catch(function(err) {
            error('Error on init subs on ready service worker; Error:'+err);
        });
    }

    function checkSubscription(subs)
    {
        // if already has subs => no action
        if( subs )
        {
            log("Subscription is active");
            return self.config.afterInit(subs);
        }

        storage().get('uid').then(function(userId){
            storage().get('srv').then(function(srvId){
                fetch(self.config.apiBaseUrl+'subscription/detect'+(srvId ? '?srv='+srvId : ''), {
                    method : 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8'
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        tz       : getTimeZone(),
                        tzOffset : -(new Date()['getTimezoneOffset']()),
                        srvId    : srvId,
                        clientId : userId,
                        marks    : self.config.marks,
                        sourceId : self.config.sourceId,
                        landingId: self.config.landingId,
                        version  : self.config.worker.version,
                        addVars  : self.config.addVars
                    })
                }).then(function(response){
                    if(response.ok)
                        return response.json();

                    throw new Error('Response was not ok; Status:'+response.status+' '+response.statusText);
                }).then(function(data){
                    if(data.status === 'ok' && data.clientId)
                        storage().set('uid', data.clientId);

                    if(data.status === 'ok' && data.srvId)
                        storage().set('srv', data.srvId);

                    self.subscriptionCount = data.subsCountCurrent;

                    if(data.subsCountCurrent > 0)
                        self.subscriptionStatus = 'activated';

                    log('Success get subscription status: '+self.subscriptionStatus);

                    self.config.afterInit(subs);
                })
                .catch(function(err){
                    error('Error on get push status from server:'+err);
                    self.config.afterInit(subs);
                });
            }).catch(function(err){
                error('Error on get srv uid:'+userId+'; on detect status from server:'+err);
                self.config.afterInit(subs);
            });
        }).catch(function(err){
            error('Error on get uid on detect status from server:'+err);
            self.config.afterInit(subs);
        });
    }

    function getPushPermission()
    {
        if( ('Notification' in window) == false )
        {
            error("Notification not supported");
            return false;
        }

        return Notification.permission;
    }

    function isDeniedPush()
    {
        return (getPushPermission() === 'denied');
    }

    function registerWorker(worker)
    {
        navigator.serviceWorker.register(worker)
        .then(function(reg){
            if(reg.installing)
                log('Service worker installing');
            else if(reg.waiting)
            {
                log('Service worker installed');
                reg.update();
            }
            else if(reg.active)
                log('Service worker active');

            self.pushServiceWorker = reg;
            afterRegisterWorker(reg);
        })
        .catch(function(err){error('Error on register service worker: '+worker+'; Error:'+err);});
    }

    function afterRegisterWorker(worker)
    {
        if( isDeniedPush() )
        {
            self.config.declined();
            throw 'The user has blocked notifications';
        }

        initSubscription();
    }

    function isDebugMode()
    {
        return self.config.debug === true;
    }

    function IndexDbStorage(dbName, store)
    {
        var db        = null;
        var storeName = null;
        var obj       = this;

        if( store )
            storeName = store;

        this.init = init;

        function init(store)
        {
            var initId = Math.random();
            //log('init store:'+store+'; db:'+dbName+'; id:'+initId);
            var promise = new Promise(function(resolve, reject) {

                if( db && store == storeName )
                {
                    //log('resolve old connection store:'+store+'; db:'+dbName+'; id:'+initId);
                    resolve(db);
                    return;
                }

                var handle = indexedDB.open(dbName);
                handle.onupgradeneeded = function(event) {
                    //log('start onupgradeneeded'+'; id:'+initId);

                    db = handle.result;

                    if (event.oldVersion < 1)
                    {
                        var st = db.createObjectStore(storeName, {keyPath: "key"});

                        var transaction = event.target.transaction;// the important part
                        var addRequest = transaction.objectStore(storeName).add({key:"version", value: event.newVersion});
                        addRequest.onsuccess = function()
                        {
                            //log('Success upgrade to version:'+event.newVersion+'; id:'+initId);
                        };
                        //log('create store:'+storeName+'; id:'+initId);
                    }

                    //log('end onupgradeneeded'+'; id:'+initId);
                };

                handle.onerror   = function(e){ reject(new Error("Error on open Db ("+dbName+"):"+e+'; id:'+initId)); };
                handle.onsuccess = function() {
                    db = handle.result; // db.version will be 3.
                    log('success init db store:'+dbName+'; id:'+initId);
                    resolve(db);
                };
            });

            return promise;
        };

        this.get = function(key)
        {
            var promise = new Promise(function(resolve, reject)
            {
                //log('start get '+key+': before init');
                obj.init(storeName).then(function(database){

                    //log('start get '+key+': after init');
                    //database.onversionchange = function(e){ console.log(e); };
                    var transact = database.transaction(storeName, "readonly");
                    var store    = transact.objectStore(storeName);

                    var data = store.get(key);
                    data.onsuccess = function(e) {
                        //log('success get '+key+': '+(e.target.result ? e.target.result.value : 'null'));
                        resolve(e.target.result ? e.target.result.value : null);
                    };
                    data.onerror = function(e) {
                        reject(new Error("Error on get key:"+key+" ("+storeName+"):"+e));
                    };
                }).catch(function(error){reject(error)});
            });

            return promise;
        };

        this.set = function(key, value)
        {
            var promise = new Promise(function(resolve, reject)
            {
                obj.init(storeName).then(function(db){
                    //log('start set '+key+': after init');
                    var transact = db.transaction(storeName, "readwrite");
                    var store    = transact.objectStore(storeName);

                    store.put({key:key, value: value}).onsuccess = function(e) {
                        resolve(e.target.result);
                    };
                }).catch(function(error){reject(error)});
            });

            return promise;
        };

        this.del = function(key)
        {
            var promise = new Promise(function(resolve, reject)
            {
                obj.init(storeName).then(function(db){
                    var transact = db.transaction(storeName, "readwrite");
                    var store    = transact.objectStore(storeName);

                    store.delete(key).onsuccess = function(e) {
                        resolve(true);
                    };
                }).catch(function(error){reject(error)});
            });

            return promise;
        };

        this.store = function(store)
        {
            storeName = store;
        };
    }

    function isPushScriptSubdomain() {
        var source = new URL(window.location.href),
            hostname = source.hostname;

        return hostname.indexOf('ms-') != -1;
    }

    function getChromeVersion () {
        var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);

        return raw ? parseInt(raw[2], 10) : false;
    }

    init();
};