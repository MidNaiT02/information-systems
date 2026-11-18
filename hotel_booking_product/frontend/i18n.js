/* Small shared EN/RU/KZ interface dictionary. Extend this map as new UI copy is added. */
(() => {
  const D = {
    en: {},
    ru: {
      'Rooms':'Номера','My booking':'Моё бронирование','Staff':'Персонал','Account':'Аккаунт','Log out':'Выйти',
      'Reservations':'Бронирования','Calendar':'Календарь','Floor map':'План этажей','Housekeeping':'Уборка','Check-in':'Заселение',
      'Loyalty':'Программа лояльности','Maintenance':'Техобслуживание','Reviews':'Отзывы','Email outbox':'Исходящие письма','Dashboard':'Панель управления','Prices':'Цены',
      'Open':'Открыта','In Progress':'В работе','Resolved':'Решена','Cancelled':'Отменена','Create ticket':'Создать заявку',
      'Guest reviews':'Отзывы гостей','Review your stay':'Оцените проживание','Submit review':'Отправить отзыв','Language':'Язык'
    },
    kz: {
      'Rooms':'Бөлмелер','My booking':'Менің брондауым','Staff':'Қызметкерлер','Account':'Аккаунт','Log out':'Шығу',
      'Reservations':'Брондаулар','Calendar':'Күнтізбе','Floor map':'Қабат жоспары','Housekeeping':'Тазалық','Check-in':'Тіркеу',
      'Loyalty':'Адалдық бағдарламасы','Maintenance':'Жөндеу','Reviews':'Пікірлер','Email outbox':'Жіберілген хаттар','Dashboard':'Басқару тақтасы','Prices':'Бағалар',
      'Open':'Ашық','In Progress':'Орындалуда','Resolved':'Шешілді','Cancelled':'Бас тартылды','Create ticket':'Өтінім жасау',
      'Guest reviews':'Қонақ пікірлері','Review your stay':'Тұруды бағалаңыз','Submit review':'Пікір жіберу','Language':'Тіл'
    }
  };
  const lang = () => localStorage.getItem('hotel-lang') || 'en';
  const translate = value => D[lang()]?.[value] || value;
  window.hotelTranslate = translate;
  const originals = new WeakMap(), tracked = new Set();
  const paint = n => { if(!originals.has(n)){originals.set(n,n.nodeValue);tracked.add(n);} const original=originals.get(n); const v=original.trim(); n.nodeValue=v ? original.replace(v,translate(v)) : original; };
  const apply = root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(paint);
  };
  window.hotelApplyTranslations = () => tracked.forEach(n => { if(n.isConnected) paint(n); });
  const start = () => {
    document.documentElement.lang=lang();
    apply(document.body);
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => { if(n.nodeType===Node.TEXT_NODE)paint(n);else if(n.nodeType===Node.ELEMENT_NODE)apply(n); }))).observe(document.body,{childList:true,subtree:true});
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
