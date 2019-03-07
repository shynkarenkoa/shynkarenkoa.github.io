(function(){
	var s = document.createElement('script');
	s.setAttribute('defer', '');
	s.setAttribute('src', "/push-wrap.js");
	s.onload = init;
	document.body.appendChild(s);

    function init() {
        var obj = new PushKaWrapper({"pid":49,"sourceId":"115","landingId":5,"marks":{"utm_source":null,"utm_medium":null,"utm_campaign":null,"utm_term":null,"utm_content":null},"popupUrl":"https:\/\/notifymepush.info\/rs\/115?count=10&declCount=3&fullScreenMode=enabled","pushKaScript":"https:\/\/pushmeandtouchme.info\/push.js?b=8","languages":{"en":{"btnSubscribe":"Subscribe","btnContinue":"Continue","btnCancel":"Cancel","btnClose":"Close","notRobot":"I'm not a robot","popupTitle":"Get notification about actual news from site","popupText":"To continue, enable the subscription"}}});
        
        obj.start(10, 600);
    }
})();