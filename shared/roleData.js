// shared/roleData.js

const ROLE_DATA = {
  villager: {
    id:'villager', name:'Dân Thường', icon:'👨‍🌾', team:'village', teamLabel:'Dân Làng',
    desc:'Không có kỹ năng đặc biệt. Dùng lý luận và quan sát để phát hiện Ma Sói trong các buổi họp làng.',
    win:'Loại bỏ toàn bộ Ma Sói khỏi làng.', nightAction:false,
  },
  werewolf: {
    id:'werewolf', name:'Ma Sói', icon:'🐺', team:'wolf', teamLabel:'Phe Sói',
    desc:'Mỗi đêm cùng đồng bọn bí mật chọn 1 người để cắn chết. Biết danh tính các Sói khác. Nếu bầy Sói hoà phiếu, không ai chết đêm đó.',
    win:'Số Sói bằng hoặc vượt số người khác còn sống.', nightAction:true,
  },
  seer: {
    id:'seer', name:'Tiên Tri', icon:'🔮', team:'village', teamLabel:'Dân Làng',
    desc:'Mỗi đêm chọn 1 người để soi và biết người đó có phải Ma Sói hay không. Không được soi ở đêm đầu tiên.',
    win:'Loại bỏ toàn bộ Ma Sói khỏi làng.', nightAction:true,
  },
  guard: {
    id:'guard', name:'Bảo Vệ', icon:'🛡️', team:'village', teamLabel:'Dân Làng',
    desc:'Mỗi đêm chọn 1 người để bảo vệ, người đó sẽ không chết vì Sói cắn. Không được bảo vệ cùng 1 người 2 đêm liên tiếp.',
    win:'Loại bỏ toàn bộ Ma Sói khỏi làng.', nightAction:true,
  },
  witch: {
    id:'witch', name:'Phù Thủy', icon:'🧙‍♀️', team:'village', teamLabel:'Dân Làng',
    desc:'Có 1 bình cứu và 1 bình độc, mỗi bình chỉ dùng 1 lần. Mỗi đêm biết ai bị Sói cắn, có thể cứu người đó hoặc dùng bình độc giết 1 người bất kỳ.',
    win:'Loại bỏ toàn bộ Ma Sói khỏi làng.', nightAction:true,
  },
  hunter: {
    id:'hunter', name:'Thợ Săn', icon:'🏹', team:'village', teamLabel:'Dân Làng',
    desc:'Khi bị chết (dù ban ngày hay ban đêm), ngay lập tức được chọn 1 người để kéo chết theo.',
    win:'Loại bỏ toàn bộ Ma Sói khỏi làng.', nightAction:false,
  },
  sheriff: {
    id:'sheriff', name:'Cảnh Sát Trưởng', icon:'⭐', team:'village', teamLabel:'Dân Làng',
    desc:'Được bầu chọn đầu game. Phiếu vote tính 2 phiếu. Khi chết được chỉ định người kế nhiệm.',
    win:'Loại bỏ toàn bộ Ma Sói khỏi làng.', nightAction:false, isElected:true,
  },
  cupid: {
    id:'cupid', name:'Thần Tình Yêu', icon:'💘', team:'village', teamLabel:'Dân Làng',
    desc:'Đêm đầu ghép đôi 2 người. Hai người yêu biết role nhau nhưng không biết ai là Cupid. Nếu 1 người chết, người kia chết theo ngay.',
    win:'Nếu cả 2 cùng phe Dân: thắng cùng Dân. Nếu có ít nhất 1 người là Sói: phe thứ ba, cả 2 phải sống sót đến cuối.',
    nightAction:true,
  },
  wolf_cub: {
    id:'wolf_cub', name:'Sói Con', icon:'🐾', team:'wolf', teamLabel:'Phe Sói',
    desc:'Thuộc phe Sói nhưng KHÔNG tham gia vote cắn người ban đêm. Nếu Sói Con chết, đêm sau bầy Sói được cắn 2 người.',
    win:'Số Sói bằng hoặc vượt số người khác còn sống.', nightAction:false,
  },
  half_wolf: {
    id:'half_wolf', name:'Nửa Người Nửa Sói', icon:'🌙', team:'village', teamLabel:'Dân Làng (ban đầu)',
    desc:'Ban đầu là Dân. Nếu bị Sói cắn, không chết mà biến thành Ma Sói, được biết bầy Sói và tham gia phe Sói.',
    win:'Ban đầu: Loại Sói. Sau khi biến: Số Sói >= Dân còn sống.', nightAction:false,
  },
  white_wolf: {
    id:'white_wolf', name:'Sói Trắng', icon:'🤍', team:'wolf', teamLabel:'Phe Sói (Solo)',
    desc:'Thức dậy cùng bầy Sói. Mỗi 2 đêm có thể bí mật giết 1 Sói khác. Mục tiêu là trở thành người sống sót duy nhất.',
    win:'Là người duy nhất còn sống đến cuối game.', nightAction:true,
  },
  thief: {
    id:'thief', name:'Ăn Trộm', icon:'🃏', team:'village', teamLabel:'Dân Làng (ban đầu)',
    desc:'Được gọi đầu tiên đêm đầu. Chọn 1 người để lấy role — người bị lấy nhận thông báo và trở thành Dân Thường. Ăn Trộm dùng role mới suốt game.',
    win:'Phụ thuộc vào role được lấy.', nightAction:true,
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ROLE_DATA };
}
