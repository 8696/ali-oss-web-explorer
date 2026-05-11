/**
 * 阿里云 OSS 主要的 Region 选项
 * 在配置抽屉中提供下拉选择,减少用户输错的概率
 */

export interface RegionOption {
  /** 用户友好的展示名 */
  label: string;
  /** 实际填入 SDK 的 region 值 */
  value: string;
}

/**
 * 阿里云对象存储 OSS 常见地域
 * 数据参考自阿里云官方文档,涵盖国内主要地域 + 海外典型地域
 */
export const OSS_REGIONS: RegionOption[] = [
  { label: '华东1(杭州)', value: 'oss-cn-hangzhou' },
  { label: '华东2(上海)', value: 'oss-cn-shanghai' },
  { label: '华北1(青岛)', value: 'oss-cn-qingdao' },
  { label: '华北2(北京)', value: 'oss-cn-beijing' },
  { label: '华北3(张家口)', value: 'oss-cn-zhangjiakou' },
  { label: '华北5(呼和浩特)', value: 'oss-cn-huhehaote' },
  { label: '华北6(乌兰察布)', value: 'oss-cn-wulanchabu' },
  { label: '华南1(深圳)', value: 'oss-cn-shenzhen' },
  { label: '华南2(河源)', value: 'oss-cn-heyuan' },
  { label: '华南3(广州)', value: 'oss-cn-guangzhou' },
  { label: '西南1(成都)', value: 'oss-cn-chengdu' },
  { label: '中国香港', value: 'oss-cn-hongkong' },
  { label: '美国西部1(硅谷)', value: 'oss-us-west-1' },
  { label: '美国东部1(弗吉尼亚)', value: 'oss-us-east-1' },
  { label: '亚太东南1(新加坡)', value: 'oss-ap-southeast-1' },
  { label: '亚太东南2(悉尼)', value: 'oss-ap-southeast-2' },
  { label: '亚太东南3(吉隆坡)', value: 'oss-ap-southeast-3' },
  { label: '亚太东南5(雅加达)', value: 'oss-ap-southeast-5' },
  { label: '亚太东北1(东京)', value: 'oss-ap-northeast-1' },
  { label: '欧洲中部1(法兰克福)', value: 'oss-eu-central-1' },
  { label: '英国(伦敦)', value: 'oss-eu-west-1' },
  { label: '中东东部1(迪拜)', value: 'oss-me-east-1' },
];
