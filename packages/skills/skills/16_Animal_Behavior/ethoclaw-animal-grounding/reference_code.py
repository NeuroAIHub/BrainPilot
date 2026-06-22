# r'C:\Users\Administrator\Desktop\rec-1-con-20250716185626.mp4'
# 这个文件，我要使用opencv来提取其中的黑色小鼠的轮廓，并且拿到每个轮廓的中心坐标center
import cv2
import numpy as np

def track_mouse(input_video_path, output_video_path):
    # 1. 打开输入视频
    cap = cv2.VideoCapture(input_video_path)
    
    if not cap.isOpened():
        print("错误：无法打开视频文件，请检查路径。")
        return

    # 获取视频的属性（宽、高、帧率）
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)

    # 2. 设置输出视频的 VideoWriter
    # 使用 mp4v 编码器保存为 mp4 格式
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_video_path, fourcc, fps, (frame_width, frame_height))

    # 设定二值化阈值（可根据实际视频亮度微调）
    # 因为小鼠是黑色的，我们将低于该阈值的像素视为小鼠
    THRESHOLD_VALUE = 80 
    # 设定最小轮廓面积，过滤掉视频边缘的污渍和噪点
    MIN_AREA = 300 

    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break  # 视频读取完毕

        frame_count += 1

        # 3. 图像预处理
        # 转换为灰度图
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # 使用高斯滤波平滑图像，减少噪点
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # 4. 二值化处理 (提取黑色区域)
        # THRESH_BINARY_INV 表示：小于 THRESHOLD_VALUE 的像素变白(255)，大于的变黑(0)
        # 这样黑色的小鼠在掩膜(mask)中就会变成白色的高亮区域
        _, thresh = cv2.threshold(blurred, THRESHOLD_VALUE, 255, cv2.THRESH_BINARY_INV)

        # 形态学操作（开运算），去除微小的白点噪点
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        
        # 5. 寻找轮廓
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if contours:
            # 找到面积最大的轮廓（假设视频中面积最大的黑色移动物体就是小鼠）
            largest_contour = max(contours, key=cv2.contourArea)

            # 过滤掉面积过小的噪点
            if cv2.contourArea(largest_contour) > MIN_AREA:
                
                # 6. 计算轮廓的中心坐标 (使用图像矩)
                M = cv2.moments(largest_contour)
                if M["m00"] != 0:
                    cX = int(M["m10"] / M["m00"])
                    cY = int(M["m01"] / M["m00"])
                else:
                    cX, cY = 0, 0

                # 7. 在原帧上绘制结果
                # 绘制绿色轮廓，线宽为2
                cv2.drawContours(frame, [largest_contour], -1, (0, 255, 0), 2)
                
                # 绘制红色中心点
                cv2.circle(frame, (cX, cY), 5, (0, 0, 255), -1)
                
                # 在中心点旁边打印坐标文本
                text = f"Center: ({cX}, {cY})"
                cv2.putText(frame, text, (cX - 50, cY - 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        # 8. 将处理后的帧写入输出视频
        out.write(frame)

    # 释放资源
    cap.release()
    out.release()
    print(f"处理完成！输出视频已保存至: {output_video_path}")

if __name__ == "__main__":
    # 请将此处替换为你的实际视频文件路径
    INPUT_VIDEO = r'input.mp4'
    OUTPUT_VIDEO = r'output.mp4'
    
    track_mouse(INPUT_VIDEO, OUTPUT_VIDEO)
