import BigNumber from 'bignumber.js';
import { toChecksumAddress } from '@/helpers/addressUtils';
import MakerCDP from './MakerCDP';

const toBigNumber = num => {
  return new BigNumber(num);
};

const bnOver = (one, two, three) => {
  return toBigNumber(one)
    .times(toBigNumber(two))
    .div(toBigNumber(three));
};

export default class MakerManager {
  constructor(props) {
    this.currentAddress = props.account.address;
    this.maker = props.maker;
    this.currentProxy = null;
    this.activeCdps = {};
    this.routeHandlers = props.routeHandlers || {
      home: () => {},
      create: () => {},
      manage: () => {}
    };
  }

  get availableCdps() {
    return this.activeCdps;
  }

  get proxy() {
    return this.currentProxy;
  }

  get cdpsWithProxy() {
    return this.cdps;
  }

  get cdpsNoProxy() {
    return this.cdpsWithoutProxy;
  }

  get makerActive() {}

  hasCdp(cdpId) {
    console.log(`${cdpId}`); // todo remove dev item
    console.log(Object.keys(this.activeCdps)); // todo remove dev item
    return Object.keys(this.activeCdps).includes(toBigNumber(cdpId).toString());
  }

  getCdp(cdpId) {
    return this.activeCdps[cdpId];
  }

  addOpenedCdp(makerCdp, cdpId) {
    this.activeCdps[cdpId] = makerCdp;
  }

  async init() {
    await this.maker.authenticate();
    this.priceService = this.maker.service('price');
    this.cdpService = await this.maker.service('cdp');
    this.proxyService = await this.maker.service('proxy');

    this.ethPrice = toBigNumber(
      (await this.priceService.getEthPrice()).toNumber()
    );
    // this.ethPrice = toBigNumber(132.93);

    this.pethPrice = toBigNumber(
      (await this.priceService.getPethPrice()).toNumber()
    );

    this.targetPrice = toBigNumber(
      (await this.cdpService.getTargetPrice()).toNumber()
    );

    this.liquidationRatio = toBigNumber(
      await this.cdpService.getLiquidationRatio()
    );
    this.liquidationPenalty = toBigNumber(
      await this.cdpService.getLiquidationPenalty()
    );
    this.stabilityFee = toBigNumber(
      await this.cdpService.getAnnualGovernanceFee()
    );

    this.wethToPethRatio = toBigNumber(
      await this.priceService.getWethToPethRatio()
    );
    console.log(this.wethToPethRatio.toString()); // todo remove dev item
    this.currentProxy = await this.proxyService.currentProxy();
    console.log(this.currentProxy); // todo remove dev item

    const { withProxy, withoutProxy } = await this.locateCdps();
    this.cdps = withProxy;
    this.cdpsWithoutProxy = withoutProxy;

    if (this.cdps.length > 0 || this.cdpsWithoutProxy.length > 0) {
      await this.loadCdpDetails();
    }
  }

  async locateCdpsWithoutProxy() {
    const directCdps = await this.maker.getCdpIds(
      this.currentAddress //proxy
    );
    const directCdpsCheckSum = await this.maker.getCdpIds(
      toChecksumAddress(this.currentAddress)
    );

    return directCdps.concat(directCdpsCheckSum);
  }

  async locateCdpsProxy() {
    const proxy = await this.maker
      .service('proxy')
      .getProxyAddress(this.currentAddress);

    return await this.maker.getCdpIds(proxy);
  }

  async locateCdps() {
    this.withoutProxy = await this.locateCdpsWithoutProxy();
    console.log(this.withoutProxy); // todo remove dev item

    this.cdps = await this.locateCdpsProxy();

    return { withProxy: this.cdps, withoutProxy: this.withoutProxy };
  }

  async loadCdpDetails() {
    for (let i = 0; i < this.cdps.length; i++) {
      this.activeCdps[this.cdps[i]] = await this.buildCdpObject(this.cdps[i]);
    }
    for (let i = 0; i < this.cdpsWithoutProxy.length; i++) {
      this.activeCdps[this.cdpsWithoutProxy[i]] = await this.buildCdpObject(
        this.cdpsWithoutProxy[i],
        {
          noProxy: true
        }
      );
    }
  }

  async buildCdpObject(cdpId, options = {}) {
    const sysVars = {
      ethPrice: this.ethPrice,
      pethPrice: this.pethPrice,
      targetPrice: this.targetPrice,
      liquidationRatio: this.liquidationRatio,
      liquidationPenalty: this.liquidationPenalty,
      stabilityFee: this.stabilityFee,
      wethToPethRatio: this.wethToPethRatio,
      currentAddress: this.currentAddress,
      ...options
    };

    const services = {
      priceService: this.priceService,
      cdpService: this.cdpService,
      proxyService: this.proxyService
    };

    const makerCDP = new MakerCDP(cdpId, this.maker, services, sysVars);
    return await makerCDP.init(cdpId);
  }

  async buildProxy() {
    const currentProxy = await this.proxyService.currentProxy();
    if (!currentProxy) {
      await this.proxyService.build();
      // eslint-disable-next-line
      this.proxyAddress = await this.proxyService.currentProxy();
      return this.proxyAddress;
    }
    this.proxyAddress = await this.proxyService.currentProxy();
    return this.proxyAddress;
  }

  async migrateCdp(cdpId) {
    const currentProxy = await this.proxyService.currentProxy();
    if (currentProxy) {
      await this.cdpService.give(cdpId, currentProxy);
    }
  }

  async refresh() {


    if (this.cdps.length > 0 || this.cdpsWithoutProxy.length > 0) {
      await this.doUpdate();
      this.routeHandlers.manage();
    } else {
      this.activeCdps = {};
      this.routeHandlers.create();
    }
  }

  async updateActiveCdp(){
    console.log('refreshing'); // todo remove dev item
    await this.locateCdps();

    const newCdps = this.cdps.filter(
      item => !Object.keys(this.activeCdps).includes(item)
    );

    const newCdpsWithoutProxy = this.cdpsWithoutProxy.filter(
      item => !Object.keys(this.activeCdps).includes(item)
    );

    for (let i = 0; i < newCdps.length; i++) {
      this.activeCdps[newCdps[i]] = await this.buildCdpObject(newCdps[i]);
    }

    for (let i = 0; i < newCdpsWithoutProxy.length; i++) {
      this.activeCdps[newCdpsWithoutProxy[i]] = await this.buildCdpObject(
        newCdpsWithoutProxy[i],
        { noProxy: true }
      );
    }
  }

  async doUpdate(route) {
    this.proxyAddress = await this.proxyService.currentProxy();
    console.log('updating'); // todo remove dev item
    let afterClose = false;
    const afterOpen = route === 'create';
    // this.migrationInProgress = false;
    for (const idProp in this.activeCdps) {
      console.log(`checking if ${idProp} needs update`); // todo remove dev item
      if (this.activeCdps[idProp].needsUpdate) {
        console.log('updating: ', idProp); // todo remove dev item
        if (this.activeCdps[idProp].closing) {
          afterClose = true;
          delete this.activeCdps[idProp];
          this.cdps = this.cdps.filter(item => item !== idProp);
          this.cdpsWithoutProxy = this.cdpsWithoutProxy.filter(
            item => item !== idProp
          );
        } else if (this.activeCdps[idProp].opening) {
          await this.refresh();
        } else {
          console.log('UPDATE CDP', idProp); // todo remove dev item
          this.activeCdps[idProp] = await this.activeCdps[idProp].update();
        }
      }
    }

    if (afterClose || afterOpen) {
      console.log('after close, move, or open'); // todo remove dev item
      // const { withProxy, withoutProxy } = await this.locateCdps();
      // this.cdps = withProxy;
      // this.cdpsWithoutProxy = withoutProxy;
      await this.updateActiveCdp();
      if (this.cdps.length > 0 || this.cdpsWithoutProxy.length > 0) {
        this.routeHandlers.manage();
      } else {
        this.routeHandlers.create();
      }
    }
    console.log('onUpdate route: ', route); // todo remove dev item
  }

  calcDrawAmt(principal, collatRatio) {
    return Math.floor(bnOver(principal, this.ethPrice, collatRatio).toNumber());
  }

  calcMinCollatRatio(priceFloor) {
    return bnOver(this.ethPrice, this.liquidationRatio, priceFloor);
  }

  calcCollatRatio(ethQty, daiQty) {
    if (ethQty <= 0 || daiQty <= 0) return 0;
    return bnOver(this.ethPrice, ethQty, daiQty);
  }

  calcLiquidationPrice(ethQty, daiQty) {
    if (ethQty <= 0 || daiQty <= 0) return 0;
    const getInt = parseInt(this.ethPrice);
    for (let i = getInt; i > 0; i--) {
      const atValue = bnOver(i, ethQty, daiQty).lte(this.liquidationRatio);
      if (atValue) {
        return i;
      }
    }
  }

  getSysVars() {
    return {
      ethPrice: this.ethPrice,
      pethPrice: this.pethPrice,
      liquidationRatio: this.liquidationRatio,
      liquidationPenalty: this.liquidationPenalty,
      stabilityFee: this.stabilityFee,
      wethToPethRatio: this.wethToPethRatio,
      currentAddress: this.currentAddress
    };
  }

  getSysServices() {
    return {
      priceService: this.priceService,
      cdpService: this.cdpService,
      proxyService: this.proxyService
    };
  }
}