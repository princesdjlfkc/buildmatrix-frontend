// price-badge.js - Show price references as badges/credits

const STORE_INFO = {
  PCWORX: { name: 'PCWorx', url: 'https://pcworx.ph', color: '#e63946' },
  DYNAQUEST: { name: 'Dynaquest PC', url: 'https://dynaquestpc.com', color: '#2a9d8f' },
  EASYPC: { name: 'EasyPC', url: 'https://easypc.com.ph', color: '#264653' },
  PCHUB: { name: 'PCHub', url: 'https://pchub.com', color: '#e76f51' },
  TECH2027: { name: 'Tech2027', url: 'https://tech2027.com', color: '#2b2d42' },
  BERMOR: { name: 'Bermor Techzone', url: 'https://bermorzone.com.ph', color: '#8d0801' }
};

async function showPriceSources(productId, category, productName) {
  try {
    const response = await fetch(`/api/prices/${category}/${productId}`);
    const data = await response.json();
    if (!data.success) return null;
    return data;
  } catch (err) {
    console.log('Price fetch failed:', err);
    return null;
  }
}

function createStoreBadges() {
  return `
    <div class="store-badges">
      <a href="https://pcworx.ph" target="_blank" class="store-badge pcworx" title="PCWorx - Check prices">
        <img src="/Images/store-logos/pcworx.png" alt="PCWorx" onerror="this.style.display='none'"><span>PCWorx</span>
      </a>
      <a href="https://dynaquestpc.com" target="_blank" class="store-badge dynaquest" title="Dynaquest PC">
        <img src="/Images/store-logos/dynaquest.png" alt="Dynaquest" onerror="this.style.display='none'"><span>Dynaquest</span>
      </a>
      <a href="https://easypc.com.ph" target="_blank" class="store-badge easypc" title="EasyPC">
        <img src="/Images/store-logos/easypc.png" alt="EasyPC" onerror="this.style.display='none'"><span>EasyPC</span>
      </a>
      <a href="https://pchub.com" target="_blank" class="store-badge pchub" title="PCHub">
        <img src="/Images/store-logos/pchub.png" alt="PCHub" onerror="this.style.display='none'"><span>PCHub</span>
      </a>
      <a href="https://tech2027.com" target="_blank" class="store-badge tech2027" title="Tech2027">
        <img src="/Images/store-logos/tech2027.png" alt="Tech2027" onerror="this.style.display='none'"><span>Tech2027</span>
      </a>
      <a href="https://bermorzone.com.ph" target="_blank" class="store-badge bermor" title="Bermor Techzone">
        <img src="/Images/store-logos/bermor.png" alt="Bermor" onerror="this.style.display='none'"><span>Bermor</span>
      </a>
    </div>
  `;
}

function createPriceBadge(priceData) {
  if (!priceData || !priceData.prices || priceData.prices.length === 0) {
    return `
      <div class="price-sources">
        <div class="sources-title">
          <i class="fas fa-store"></i> 
          Price References:
        </div>
        ${createStoreBadges()}
        <div class="sources-footer">
          <i class="fas fa-info-circle"></i> 
          Click store badges to check current prices. References updated weekly.
        </div>
      </div>
    `;
  }
  
  const bestStore = priceData.bestPrice;
  const otherPrices = priceData.prices.filter(p => p.store !== bestStore?.store);
  
  return `
    <div class="price-sources with-prices">
      <div class="sources-title">
        <i class="fas fa-tags"></i> 
        Available at:
      </div>
      
      ${bestStore ? `
        <div class="best-price-badge">
          <span class="best-label">BEST PRICE</span>
          <a href="${bestStore.url || STORE_INFO[bestStore.store].url}" target="_blank" class="store-link ${bestStore.store.toLowerCase()}">
            <img src="/Images/store-logos/${bestStore.store.toLowerCase()}.png" alt="${bestStore.store}" onerror="this.style.display='none'">
            <span class="store-name">${STORE_INFO[bestStore.store].name}</span>
            <span class="price">₱${bestStore.price.toLocaleString()}</span>
          </a>
        </div>
      ` : ''}
      
      ${otherPrices.length > 0 ? `
        <div class="other-prices">
          <div class="other-label">Also at:</div>
          ${otherPrices.map(p => `
            <a href="${p.url || STORE_INFO[p.store].url}" target="_blank" class="other-store-link ${p.store.toLowerCase()}">
              <img src="/Images/store-logos/${p.store.toLowerCase()}.png" alt="${p.store}" onerror="this.style.display='none'">
              <span>${STORE_INFO[p.store].name}</span>
              <span class="price">₱${p.price.toLocaleString()}</span>
            </a>
          `).join('')}
        </div>
      ` : createStoreBadges()}
      
      <div class="sources-footer">
        <i class="fas fa-external-link-alt"></i> 
        Prices are references only. Click to visit store.
      </div>
    </div>
  `;
}

async function enhanceProductCard(productCard, productId, category, productName) {
  try {
    const priceData = await showPriceSources(productId, category, productName);
    const badgeHTML = createPriceBadge(priceData);
    const priceElement = productCard.querySelector('.product-price');
    if (priceElement) {
      priceElement.insertAdjacentHTML('afterend', badgeHTML);
    }
  } catch (err) {
    const priceElement = productCard.querySelector('.product-price');
    if (priceElement) {
      priceElement.insertAdjacentHTML('afterend', createPriceBadge(null));
    }
  }
}

window.priceBadge = {
  showPriceSources,
  createPriceBadge,
  enhanceProductCard
};