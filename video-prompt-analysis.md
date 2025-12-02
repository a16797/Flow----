# Google Labs Flow 视频页面结构分析文档

## 1. 页面结构概览

### 1.1 整体布局
- 页面使用 `data-index` 属性标识每个视频项目
- 每个视频项目包含独立的视频播放器和提示词信息
- 使用动态生成的CSS类名（如 `sc-c884da2c-1`, `sc-333e51d6-0` 等）

### 1.2 视频项目结构
```html
<div data-index="{数字}" data-item-index="{数字}">
  <div class="sc-c884da2c-1 iieXSn">
    <div class="sc-333e51d6-0 fpoBvX">
      <!-- 视频容器 -->
      <div class="sc-20145656-0 ekxBaW">
        <!-- 视频播放器区域 -->
        <!-- 提示词区域 -->
      </div>
    </div>
  </div>
</div>
```

## 2. 视频元素结构

### 2.1 视频播放器
```html
<div class="sc-95642653-0 eqYXoz">
  <div class="sc-95642653-1 cFwKkl">
    <div class="sc-d90fd836-2 dLxTam">
      <div class="sc-d90fd836-3 vjIKn">
        <div class="sc-dc87e016-0 [类名]">
          <div class="sc-dc87e016-1 bcjlDW">
            <div class="sc-7c2943cd-0 ibsgUX">
              <div class="sc-7c2943cd-4 gREUCD">
                <div class="sc-7c2943cd-1 jiHCUJ">
                  <div>
                    <video src="https://storage.googleapis.com/ai-sandbox-videofx/video/{视频ID}?"
                            poster="https://storage.googleapis.com/ai-sandbox-videofx/image/{视频ID}?"
                            controls>
                    </video>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### 2.2 关键信息提取点
- **视频URL**: `<video>` 标签的 `src` 属性
  - 格式: `https://storage.googleapis.com/ai-sandbox-videofx/video/{UUID}`
  - 包含 GoogleAccessId、Expires、Signature 等参数

- **视频缩略图**: `<video>` 标签的 `poster` 属性
  - 格式: `https://storage.googleapis.com/ai-sandbox-videofx/image/{UUID}`

## 3. 提示词元素结构

### 3.1 提示词容器
```html
<div class="sc-dfb46854-0 gcOqQf sc-dc87e016-3 cAscXs">
  <div class="sc-dfb46854-2 [类名]">
    <div class="sc-dfb46854-1 bOAkGK">
      <div class="sc-e6a99d5c-0 WNkXr">
        <h4 class="sc-e6a99d5c-1 czoWNZ">Prompt input</h4>
        <div class="sc-e6a99d5c-2 gLbruo">
          <div class="sc-e6a99d5c-3 eVxyTT">
            {提示词文本}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### 3.2 提示词特征
- **位置**: `.sc-e6a99d5c-3.eVxyTT` 类的 div 内
- **格式**: 通常包含镜头描述、场景描述、对话、音效等信息
- **语言**: 中英文混合
- **长度**: 不定，通常包含详细的场景描述

## 4. 模型信息结构

### 4.1 模型版本显示
```html
<div class="sc-20145656-5 kNaSXr">
  <div class="sc-20145656-10 ifyMsG">
    Veo 3.1 - Fast [Lower Priority]
  </div>
</div>
```

### 4.2 控制按钮区域
```html
<div class="sc-20145656-6 dDIggU">
  <button> <!-- 添加到场景 --> </button>
  <button> <!-- 复用提示词 --> </button>
  <button> <!-- 更多选项 --> </button>
</div>
```

## 5. 视频和提示词对应关系规律

### 5.1 一对多关系
- **一个提示词** 对应 **多个视频**（通常是2-4个）
- 所有使用相同提示词的视频具有相同的 UUID 前缀模式
- 每个视频有唯一的完整 UUID

### 5.2 视频生成模式
1. **批量生成**: 用户输入一个提示词，系统生成多个版本
2. **独立存储**: 每个视频独立存储在 Google Cloud Storage
3. **统一展示**: 页面将同一提示词的所有视频版本一起展示

### 5.3 视频时长
- **固定时长**: 所有视频都是8秒（从 `<input max="8">` 可以看出）
- **进度条**: 每个视频都有独立的播放进度控制

## 6. CSS类名规律

### 6.1 动态类名
- 类名格式: `sc-{hash}-{index}-{suffix}`
- 例如: `sc-c884da2c-1`, `sc-333e51d6-0`, `sc-95642653-0`
- 这些类名是动态生成的，每次页面加载可能不同

### 6.2 稳定的选择器
虽然类名是动态的，但结构层次是稳定的：
- 使用属性选择器更可靠（如 `[data-index]`）
- 使用标签名和层次关系定位元素

## 7. 批量下载实现策略

### 7.1 视频识别
- 通过 `video` 标签定位所有视频元素
- 提取 `src` 属性作为下载URL
- 提取 `poster` 属性作为缩略图（可选）

### 7.2 提示词提取
- 查找每个视频对应的提示词容器
- 通过DOM遍历或XPath定位提示词文本
- 清理文本内容，去除多余空白

### 7.3 文件命名规则
- **基础名称**: 提示词前10个字符
- **清理规则**:
  - 移除特殊字符: `\/:*?"<>|`
  - 替换空格为下划线
  - 移除中英文混合中的多余符号
- **序号处理**: 如果同一提示词有多个视频，添加序号后缀

### 7.4 XPath选择器示例
```xpath
// 视频元素
//div[contains(@class,'sc-7c2943cd-0')]//video

// 提示词元素
//div[contains(@class,'sc-e6a99d5c-3')]//div[contains(@class,'eVxyTT')]
```

## 8. 错误处理

### 8.1 常见问题
1. **视频加载失败**: src URL 过期或无效
2. **提示词缺失**: DOM结构变化
3. **权限问题**: 视频无法下载

### 8.2 解决方案
1. **URL验证**: 检查 Expires 参数是否有效
2. **备用选择器**: 准备多个XPath选择器
3. **重试机制**: 下载失败时自动重试

## 9. 更新日志

- **2024-12-03**: 初始版本，分析当前页面结构
- 待更新: 根据页面变化持续更新