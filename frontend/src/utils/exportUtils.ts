import { jsPDF } from 'jspdf';
import { APP_NAME } from "./branding";
import html2canvas from 'html2canvas';

/**
 * 대화 내역을 Markdown 파일로 내보냅니다.
 */
export const exportToMarkdown = (title: string, messages: any[]) => {
  try {
    let content = `# ${title}\n\n`;
    content += `기록 일시: ${new Date().toLocaleString('ko-KR')}\n\n---\n\n`;

    messages.forEach((msg) => {
      const role = msg.role === 'user' ? '나' : APP_NAME;
      const timestamp = new Date(msg.timestamp).toLocaleTimeString('ko-KR');
      content += `### [${role}] - ${timestamp}\n\n`;
      content += `${msg.content}\n\n`;
      
      if (msg.thoughtSteps && msg.thoughtSteps.length > 0) {
        content += `> **AI 추론 과정:**\n`;
        msg.thoughtSteps.forEach((step: string) => {
          content += `> - ${step}\n`;
        });
        content += `\n`;
      }
      
      content += `---\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}_${new Date().getTime()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    console.error('Markdown 내보내기 에러:', err);
    alert('Markdown 생성 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
  }
};

/**
 * 대화 내역을 PDF 파일로 내보냅니다 (브라우저 기본 인쇄 기능 활용).
 */
export const exportToPDF = async (title: string, containerId: string) => {
  try {
    // 툴팁 등 인쇄에 방해되는 UI가 있다면 숨김 처리할 시간을 위해 잠시 대기
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 브라우저 기본 인쇄 호출
    // globals.css의 @media print 규칙에 의해 채팅 창 외의 UI는 자동으로 숨겨집니다.
    window.print();
    
    console.log(`${title} PDF 내보내기 시도됨`);
  } catch (err: any) {
    console.error('PDF 내보내기 에러:', err);
    alert('PDF 생성 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
  }
};
