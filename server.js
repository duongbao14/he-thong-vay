const express = require('express');
const path = require('path');
const multer = require('multer');
const { Telegraf, Markup } = require('telegraf');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ====== CẤU HÌNH TOKEN & ID NHÓM ======
const BOT_TOKEN = '8785235098:AAFFeY2npHmBRlt8ftqvHt1EJZE8mwv0kxk'; // Bot chính
const SOURCE_GROUP_ID = -1003645575289;   // Nhóm duyệt hồ sơ

const MDM_GROUP_ID = -1004430700287;         // Nhóm MDM
const ICLOUD_GROUP_ID = -1003472574391;   // Nhóm iCloud
// ======================================

const bot = new Telegraf(BOT_TOKEN);
const pendingReview = new Map(); // Dùng để lưu ID của các hình ảnh đính kèm

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API Nhận hồ sơ từ trang Web gửi lên và tự động tạo nút bấm
app.post('/api/submit-form', upload.fields([
  { name: 'cccd_front', maxCount: 1 },
  { name: 'cccd_back', maxCount: 1 },
  { name: 'portrait', maxCount: 1 }
]), async (req, res) => {
  try {
    const data = req.body;
    const files = req.files || {};

    let categoryText = (data.category || '').toUpperCase();
    if (data.category === 'Vay Tiêu Dùng') {
      if (data.vtd_type === 'icloud') categoryText += ' (Tài Lộc iCloud)';
      else if (data.vtd_type === 'store') categoryText += ' (Thông Qua Cửa Hàng)';
    }

    let message = 
`📌 LOẠI HỒ SƠ: ${categoryText}
Tên khách hàng : ${data.fullname || ''}
Sdt : ${data.phone || ''}
Sdt zalo : ${data.zalo_phone || ''}
Nghề nghiệp : ${data.job || ''}
Địa chỉ : ${data.address || ''}
Tên người thân : ${data.parent_name || ''}
SDT người thân : ${data.parent_phone || ''}
Link fb khách hàng : ${data.fb_kh || ''}
Link fb người thân 1 : ${data.fb_nt1 || ''}
Link fb người thân 2 : ${data.fb_nt2 || ''}
Loại máy : ${data.device_type || ''}
Dung lượng máy : ${data.device_storage || ''}
IMEI 1 : ${data.imei1 || ''}
IMEI 2 : ${data.imei2 || ''}
seri máy : ${data.seri || ''}`;

    if (data.category === 'Trả Góp Máy') {
      message += `
Giá trị máy : ${data.device_value || ''} VNĐ
Trả trước : ${data.prepaid_amount || ''} VNĐ
Tên cửa hàng : ${data.store_name || ''}
Số điện thoại cửa hàng : ${data.store_phone || ''}
Địa chỉ cửa hàng : ${data.store_address || ''}
Số tiền vay + tháng : ${data.loan_info || ''}
Góp hàng tháng: ${data.monthly_payment || ''}`;
    } else {
      // Nhánh xử lý tuỳ chọn Vay Tiêu Dùng
      if (data.vtd_type === 'icloud') {
        message += `
Máy chủ : ${data.server || ''}
CTV : ${data.staff || ''}`;
      } else if (data.vtd_type === 'store') {
        message += `
Tên cửa hàng : ${data.store_name || ''}
Số điện thoại cửa hàng : ${data.store_phone || ''}
Địa chỉ cửa hàng : ${data.store_address || ''}`;
      }

      message += `
Số tiền vay + tháng : ${data.loan_info || ''}
Góp hàng tháng: ${data.monthly_payment || ''}`;
    }

    // 1. Gửi tin nhắn văn bản
    const sentMsg = await bot.telegram.sendMessage(SOURCE_GROUP_ID, message, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('1️⃣ MDM', `btnmdm_dummy`)],
        [Markup.button.callback('2️⃣ iCloud', `btnicloud_dummy`)],
        [Markup.button.callback('❌ Từ chối hồ sơ', `btnreject_dummy`)],
      ])
    });

    const rootMsgId = sentMsg.message_id;

    // Cập nhật lại nút bấm chứa rootMsgId
    await bot.telegram.editMessageReplyMarkup(SOURCE_GROUP_ID, rootMsgId, undefined, Markup.inlineKeyboard([
      [Markup.button.callback('1️⃣ MDM', `btnmdm_${rootMsgId}`)],
      [Markup.button.callback('2️⃣ iCloud', `btnicloud_${rootMsgId}`)],
      [Markup.button.callback('❌ Từ chối hồ sơ', `btnreject_${rootMsgId}`)],
    ]).reply_markup);

    // Mảng chứa ID của các ảnh để forward sau này
    const photoMsgIds = [];

    // 2. Gửi các ảnh đính kèm (nếu có) lên nhóm duyệt và lưu lại ID
    const sendPhotoField = async (fileArr, caption) => {
      if (fileArr && fileArr[0]) {
        const photoMsg = await bot.telegram.sendPhoto(SOURCE_GROUP_ID, {
          source: fileArr[0].buffer,
          filename: 'image.jpg'
        }, { caption });
        photoMsgIds.push(photoMsg.message_id); // Ghi nhận ID bức ảnh
      }
    };

    await sendPhotoField(files.cccd_front, `🪪 CCCD Trước - ${data.fullname}`);
    await sendPhotoField(files.cccd_back, `🪪 CCCD Sau - ${data.fullname}`);
    await sendPhotoField(files.portrait, `👤 Chân Dung - ${data.fullname}`);

    // Đưa danh sách ID ảnh vào Map để gọi lại khi bấm nút
    pendingReview.set(rootMsgId, { 
      sourceMessageId: rootMsgId,
      photoIds: photoMsgIds 
    });

    res.json({ success: true, message: 'Gửi hồ sơ thành công!' });
  } catch (error) {
    console.error('Lỗi xử lý gửi form:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Xử lý sự kiện bấm nút 1️⃣ MDM
bot.action(/btnmdm_(\d+)/, async (ctx) => {
  const sourceMessageId = Number(ctx.match[1]);
  const reviewData = pendingReview.get(sourceMessageId);

  try {
    // Forward tin nhắn Text
    await bot.telegram.forwardMessage(MDM_GROUP_ID, SOURCE_GROUP_ID, sourceMessageId);

    // Forward các hình ảnh đi kèm
    if (reviewData && reviewData.photoIds) {
      for (const photoId of reviewData.photoIds) {
        await bot.telegram.forwardMessage(MDM_GROUP_ID, SOURCE_GROUP_ID, photoId);
        // Tùy chọn: Xóa luôn ảnh ở nhóm duyệt cho đỡ rác
        await ctx.telegram.deleteMessage(SOURCE_GROUP_ID, photoId).catch(() => {});
      }
    }

    // Sửa nội dung tin nhắn gốc thành Đã chuyển (sẽ tự mất nút bấm)
    await ctx.editMessageText('✅ Đã chuyển hồ sơ sang nhóm MDM.');
    await ctx.answerCbQuery('Đã chuyển sang MDM kèm ảnh!');
    pendingReview.delete(sourceMessageId); // Dọn dẹp bộ nhớ
  } catch (err) {
    console.error('Lỗi MDM:', err.message);
    await ctx.answerCbQuery('Có lỗi xảy ra, xem terminal!');
  }
});

// Xử lý sự kiện bấm nút 2️⃣ iCloud
bot.action(/btnicloud_(\d+)/, async (ctx) => {
  const sourceMessageId = Number(ctx.match[1]);
  const reviewData = pendingReview.get(sourceMessageId);

  try {
    // Forward tin nhắn Text
    await bot.telegram.forwardMessage(ICLOUD_GROUP_ID, SOURCE_GROUP_ID, sourceMessageId);

    // Forward các hình ảnh đi kèm
    if (reviewData && reviewData.photoIds) {
      for (const photoId of reviewData.photoIds) {
        await bot.telegram.forwardMessage(ICLOUD_GROUP_ID, SOURCE_GROUP_ID, photoId);
        await ctx.telegram.deleteMessage(SOURCE_GROUP_ID, photoId).catch(() => {});
      }
    }

    await ctx.editMessageText('✅ Đã chuyển hồ sơ sang nhóm iCloud.');
    await ctx.answerCbQuery('Đã chuyển sang iCloud kèm ảnh!');
    pendingReview.delete(sourceMessageId);
  } catch (err) {
    console.error('Lỗi iCloud:', err.message);
    await ctx.answerCbQuery('Có lỗi xảy ra, xem terminal!');
  }
});

// Xử lý sự kiện bấm nút ❌ Từ chối hồ sơ
bot.action(/btnreject_(\d+)/, async (ctx) => {
  const sourceMessageId = Number(ctx.match[1]);
  const reviewData = pendingReview.get(sourceMessageId);

  try {
    // Xóa các bức ảnh trong nhóm duyệt
    if (reviewData && reviewData.photoIds) {
      for (const photoId of reviewData.photoIds) {
        await ctx.telegram.deleteMessage(SOURCE_GROUP_ID, photoId).catch(() => {});
      }
    }

    // Đổi text thành Đã từ chối (bỏ nút bấm)
    await ctx.editMessageText('❌ Đã TỪ CHỐI hồ sơ.');
    await ctx.answerCbQuery('Đã từ chối!');
    pendingReview.delete(sourceMessageId);
  } catch (err) {
    console.error('Lỗi từ chối:', err.message);
    await ctx.answerCbQuery('Có lỗi xảy ra!');
  }
});

bot.launch();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Hệ thống Backend và Bot đang chạy tại: http://localhost:${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
