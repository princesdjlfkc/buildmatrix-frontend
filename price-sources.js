// price-sources.js - PH store references for PC parts
const axios = require('axios');
const cheerio = require('cheerio');

const STORES = {
  PCWORX: {
    name: 'PCWorx',
    url: 'https://pcworx.ph',
    logo: '/Images/store-logos/pcworx.png',
    color: '#e63946',
    homepage: 'https://pcworx.ph',
    searchUrl: 'https://pcworx.ph/search?q='
  },
  DYNAQUEST: {
    name: 'Dynaquest PC',
    url: 'https://dynaquestpc.com',
    logo: '/Images/store-logos/dynaquest.png',
    color: '#2a9d8f',
    homepage: 'https://dynaquestpc.com',
    searchUrl: 'https://dynaquestpc.com/index.php?route=product/search&search='
  },
  EASYPC: {
    name: 'EasyPC',
    url: 'https://easypc.com.ph',
    logo: '/Images/store-logos/easypc.png',
    color: '#264653',
    homepage: 'https://easypc.com.ph',
    searchUrl: 'https://easypc.com.ph/search?q='
  },
  PCHUB: {
    name: 'PCHub',
    url: 'https://pchub.com',
    logo: '/Images/store-logos/pchub.png',
    color: '#e76f51',
    homepage: 'https://pchub.com',
    searchUrl: 'https://pchub.com/index.php?route=product/search&search='
  },
  TECH2027: {
    name: 'Tech2027',
    url: 'https://tech2027.com',
    logo: '/Images/store-logos/tech2027.png',
    color: '#2b2d42',
    homepage: 'https://tech2027.com',
    searchUrl: 'https://tech2027.com/index.php?route=product/search&search='
  },
  BERMOR: {
    name: 'Bermor Techzone',
    url: 'https://bermorzone.com.ph',
    logo: '/Images/store-logos/bermor.png',
    color: '#8d0801',
    homepage: 'https://bermorzone.com.ph',
    searchUrl: 'https://bermorzone.com.ph/index.php?route=product/search&search='
  }
};

let priceCache = {
  lastUpdate: null,
  prices: {}
};

async function scrapePCWorx(productName) {
  try {
    const searchUrl = `${STORES.PCWORX.searchUrl}${encodeURIComponent(productName)}`;
    const response = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'BuildMatrix/1.0 (Reference Bot)' },
      timeout: 3000
    });
    return {
      store: 'PCWORX',
      url: STORES.PCWORX.homepage,
      found: false,
      price: null
    };
  } catch (error) {
    return { store: 'PCWORX', url: STORES.PCWORX.homepage, found: false, price: null };
  }
}

async function scrapeDynaquest(productName) {
  try {
    return { store: 'DYNAQUEST', url: STORES.DYNAQUEST.homepage, found: false, price: null };
  } catch (error) {
    return { store: 'DYNAQUEST', url: STORES.DYNAQUEST.homepage, found: false, price: null };
  }
}

async function scrapeEasyPC(productName) {
  try {
    return { store: 'EASYPC', url: STORES.EASYPC.homepage, found: false, price: null };
  } catch (error) {
    return { store: 'EASYPC', url: STORES.EASYPC.homepage, found: false, price: null };
  }
}

async function scrapePCHub(productName) {
  try {
    return { store: 'PCHUB', url: STORES.PCHUB.homepage, found: false, price: null };
  } catch (error) {
    return { store: 'PCHUB', url: STORES.PCHUB.homepage, found: false, price: null };
  }
}

async function scrapeTech2027(productName) {
  try {
    return { store: 'TECH2027', url: STORES.TECH2027.homepage, found: false, price: null };
  } catch (error) {
    return { store: 'TECH2027', url: STORES.TECH2027.homepage, found: false, price: null };
  }
}

async function scrapeBermor(productName) {
  try {
    return { store: 'BERMOR', url: STORES.BERMOR.homepage, found: false, price: null };
  } catch (error) {
    return { store: 'BERMOR', url: STORES.BERMOR.homepage, found: false, price: null };
  }
}

async function getPricesForProduct(productName, category) {
  const scrapers = [
    scrapePCWorx(productName),
    scrapeDynaquest(productName),
    scrapeEasyPC(productName),
    scrapePCHub(productName),
    scrapeTech2027(productName),
    scrapeBermor(productName)
  ];
  
  const results = await Promise.all(scrapers);
  const foundPrices = results.filter(r => r.found && r.price > 0);
  foundPrices.sort((a, b) => a.price - b.price);
  
  return {
    product: productName,
    category: category,
    prices: foundPrices,
    bestPrice: foundPrices.length > 0 ? foundPrices[0] : null,
    stores: STORES,
    lastUpdated: new Date().toISOString()
  };
}

module.exports = {
  STORES,
  getPricesForProduct
};