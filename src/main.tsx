import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
class AppBoundary extends React.Component<{children:React.ReactNode},{error:string}> {
 state={error:''}
 static getDerivedStateFromError(error:Error){return {error:error.message}}
 render(){return this.state.error?<main className="boot-screen"><h1>工作区暂时无法显示</h1><p>{this.state.error}</p><button className="button" onClick={()=>location.reload()}>重新加载</button></main>:this.props.children}
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppBoundary><App/></AppBoundary></React.StrictMode>)
